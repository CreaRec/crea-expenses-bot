const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
const propertiesReader = require('properties-reader');
const moment = require('moment');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');

const TG_BOT_EXPENSES_TOKEN = process.env.TG_BOT_EXPENSES_TOKEN;
const TG_BOT_EXPENSES_DB_NAME = process.env.TG_BOT_EXPENSES_DB_NAME;
const POSTGRES_USER = process.env.POSTGRES_USER;
const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD;

const properties = propertiesReader('config.properties');

const pool = createDbConnection();

const allowedUserIds = properties.get("bot.allowedUsers").split(",").filter(Boolean);
const notifyUserIds = properties.get("bot.notifyUsers").split(",").filter(Boolean);
const statementDay = parseInt(properties.get("statement.day"), 10); // start of the new month range

const CommandType = {
	FOOD: "/food",
	GENERAL: "/general",
	FUN: "/fun",
	TOTAL: "/total",
	PREV_TOTAL: "/prevTotal",
	START: "/start",
	CANCEL: "/cancel",
	HELP: "/help",
	REPORT: "/report",
	SCHEDULED_REPORT: "/scheduledReport"
}

const StateType = {
	START: 'START',
	ADDING: 'ADDING'
};

const states = {};
const categoryStates = {};

const bot = new TelegramBot(TG_BOT_EXPENSES_TOKEN, {polling: true});

let limitGeneral = properties.get("money.limit.general.monthly");
let limitFood = properties.get("money.limit.food.monthly");
let limitFun = properties.get("money.limit.fun.monthly");

const CategoryType = {
	FOOD: {
		name: 'FOOD',
		command: CommandType.FOOD,
		limit: limitFood
	},
	GENERAL: {
		name: 'GENERAL',
		command: CommandType.GENERAL,
		limit: limitGeneral
	},
	FUN: {
		name: 'FUN',
		command: CommandType.FUN,
		limit: limitFun
	}
};

cron.schedule(properties.get("money.limit.notification.cron"), () => {
	sendScheduledReport();
});

bot.on('message', (msg) => {
	const chatId = msg.chat.id;
	const userId = msg.from.id;
	const messageText = msg.text;

	saveLogToFile("UID:[" + userId + "] - MSG:[" + messageText + "]");

	if (chatId && messageText && userId) {
		if (!allowedUserIds.includes(userId.toString())) {
			sendReplyMessage(bot, chatId, 'Нет доступа');
			return;
		}

		let categoryType = null;
		if (messageText === CategoryType.FOOD.command) {
			categoryType = CategoryType.FOOD;
		} else if (messageText === CategoryType.GENERAL.command) {
			categoryType = CategoryType.GENERAL;
		} else if (messageText === CategoryType.FUN.command) {
			categoryType = CategoryType.FUN;
		}

		if (categoryType) {
			states[chatId] = StateType.ADDING;
			categoryStates[chatId] = categoryType;
			sendReplyMessage(bot, chatId, `Добавление расходов в категорию ${categoryType.name}. Введите сумму`);
		} else if (messageText === CommandType.TOTAL) {
			sendTotal(bot, chatId);
		} else if (messageText === CommandType.PREV_TOTAL) {
			sendPrevTotal(bot, chatId);
		} else if (messageText === CommandType.HELP) {
			sendHelp(bot, chatId);
		} else if (messageText === CommandType.REPORT) {
			sendReport(bot, chatId);
		} else if (messageText === CommandType.SCHEDULED_REPORT) {
			sendScheduledReport();
		} else if (messageText === CommandType.CANCEL || messageText === CommandType.START) {
			states[chatId] = StateType.START;
			delete categoryStates[chatId];
			sendReplyMessage(bot, chatId, 'Выберите категорию');
		} else {
			if (states[chatId] === StateType.ADDING) {
				let amount = parseInt(messageText);
				if (Number.isInteger(amount)) {
					if (amount <= 0) {
						sendReplyMessage(bot, chatId, 'Сумма должна быть больше нуля!');
						return;
					}
					categoryType = categoryStates[chatId];
					if (!categoryType) {
						states[chatId] = StateType.START;
						sendReplyMessage(bot, chatId, 'Что-то пошло не так: выберите категорию');
						return;
					}

					const eventData = {
						amount: amount,
						category: categoryType.name,
						datetime: formatDatetime(moment()),
						user_id: userId,
						user_name: msg.from.username
					};
					insertEvent(eventData)
						.then((result) => {
							const insertedId = result[0].id;
							sendAddConfirmationMessage(bot, chatId, insertedId, eventData.amount);
							sendTotal(bot, chatId);
							sendNotifications(bot, insertedId, eventData)
						})
						.catch((error) => {
							console.error('Error:', error);
							sendReplyMessage(bot, chatId, 'Ошибка на сервере!');
						});
					return;
				} else {
					sendReplyMessage(bot, chatId, 'Неправильный формат суммы!');
					return;
				}
			}
			sendReplyMessage(bot, chatId, 'Неизвестная команда!');
		}
	}
});

bot.on("callback_query", (msg) => {
	saveLogToFile("Callback recieved")
	let data = JSON.parse(msg.data);
	if (data) {
		if (data.command === "delete" && data.eventId) {
			deleteEvent(data.eventId)
				.then((result) => {
					sendReplyMessage(bot, msg.message.chat.id, 'Расход успешно удален (' + data.amount + "$)!");
					sendTotal(bot, msg.message.chat.id);
				})
				.catch((error) => {
					console.error('Error:', error);
					sendReplyMessage(bot, msg.message.chat.id, 'Ошибка на сервере!');
				});
		}
	}
});

function sendReplyMessage(bot, chatId, message) {
	const keyboard = {
		reply_markup: {
			resize_keyboard: true,
			one_time_keyboard: true,
			keyboard: [
				[
					{text: CategoryType.FOOD.command},
					{text: CategoryType.GENERAL.command},
					{text: CategoryType.FUN.command}
				],
				[
					{text: CommandType.TOTAL},
					{text: CommandType.CANCEL}
				]
			]
		}
	};

	bot.sendMessage(chatId, message, keyboard);
}

function sendAddConfirmationMessage(bot, chatId, eventId, amount) {
	const keyboard = {
		reply_markup: {
			inline_keyboard: [[
				{
					text: 'Удалить расход (' + amount + '$)',
					callback_data: JSON.stringify({
						command: 'delete',
						amount: amount,
						eventId: eventId
					})
				}
			]]
		}
	};

	bot.sendMessage(chatId, 'Расход успешно добавлен!', keyboard);
}

function sendNotifications(bot, eventId, eventData) {
	let currentUserId = eventData.user_id;
	let message = `Пользователь ${eventData.user_name} (${currentUserId}) добавил(а) сумму ${eventData.amount} в категорию ${eventData.category}`
	notifyUserIds.filter(userId => parseInt(userId) !== currentUserId).forEach(userId => {
		const keyboard = {
			reply_markup: {
				inline_keyboard: [[
					{
						text: 'Удалить расход (' + eventData.amount + '$)',
						callback_data: JSON.stringify({
							command: 'delete',
							amount: eventData.amount,
							eventId: eventId
						})
					}
				]]
			}
		};
		bot.sendMessage(userId, message, keyboard)
	})
}

function sendTotal(bot, chatId) {
	getGroupedEventsForCustomMonth()
		.then((result) => {
			let totalAmount = 0;
			let totalLimit = 0;
			let replyMessage = 'Расходы по категориям:\n';

			result.forEach(item => {
				let limit = CategoryType[item.category].limit;
				replyMessage += `${item.category}: ${item.total_amount} (${limit})\n`;
				totalAmount += parseInt(item.total_amount);
				totalLimit += parseInt(limit);
			})

			replyMessage += `Всего: ${totalAmount} (${totalLimit})`;
			sendReplyMessage(bot, chatId, replyMessage);
		})
		.catch((error) => {
			console.error('Error:', error);
			sendReplyMessage(bot, chatId, 'Ошибка на сервере!');
		});
}

function sendPrevTotal(bot, chatId) {
	getGroupedEventsForPreviousMonth()
		.then((result) => {
			let totalAmount = 0;
			let replyMessage = 'Расходы по категориям за предыдущий месяц (' + (moment().subtract(1, 'month').month() + 1) + '):\n';

			result.forEach(item => {
				replyMessage += `${item.category}: ${item.total_amount}\n`;
				totalAmount += parseInt(item.total_amount);
			})

			replyMessage += `Всего: ${totalAmount}`;
			sendReplyMessage(bot, chatId, replyMessage);
		})
		.catch((error) => {
			console.error('Error:', error);
			sendReplyMessage(bot, chatId, 'Ошибка на сервере!');
		});
}

function sendHelp(bot, chatId) {
	let replyMessage = "Список доступных команд:\n";
	for (const [key, value] of Object.entries(CommandType)) {
		replyMessage += value + "\n"
	}
	sendReplyMessage(bot, chatId, replyMessage);
}

function sendReport(bot, chatId) {
	getEventsForCustomMonth()
		.then((result) => {
			let replyMessage = "Все транзакции за месяц:\n";
			replyMessage += "ID - amount - category - datetime - username:\n";
			result.forEach(item => {
				replyMessage += `${item.id} - ${item.amount}$ - ${item.category} - ${formatDatetime(moment(item.datetime))} - ${item.user_name}\n`;
			})
			sendReplyMessage(bot, chatId, replyMessage);
		})
		.catch((error) => {
			console.error('Error:', error);
			sendReplyMessage(bot, chatId, 'Ошибка на сервере!');
		});
}

function insertEvent(event) {
	return new Promise((resolve, reject) => {
		const queryText = `INSERT INTO event (amount, category, datetime, user_id, user_name) 
                           VALUES ($1, $2, $3, $4, $5) RETURNING *`;
		const queryParams = [event.amount, event.category, event.datetime, event.user_id, event.user_name];
		pool.query(queryText, queryParams, (error, results, fields) => {
			if (error) {
				reject(error);
			} else {
				resolve(results.rows);
			}
		});
	});
}

function deleteEvent(eventId) {
	return new Promise((resolve, reject) => {
		const queryText = 'DELETE FROM event WHERE id = $1';
		pool.query(queryText, [eventId], (error, results, fields) => {
			if (error) {
				reject(error);
			} else {
				resolve(results.rowCount);
			}
		});
	});
}

function getEventsForCustomMonth() {
	const { startDate, endDate } = getCustomCurrentMonthRange();

	return new Promise((resolve, reject) => {
		const queryText = `SELECT * FROM event
                           WHERE datetime >= $1 AND datetime <= $2`;
		pool.query(queryText, [startDate.format('YYYY-MM-DD HH:mm:ss'), endDate.format('YYYY-MM-DD HH:mm:ss')], (error, results) => {
			if (error) {
				reject(error);
			} else {
				resolve(results.rows);
			}
		});
	});
}

function getGroupedEventsForCustomMonth() {
	const { startDate, endDate } = getCustomCurrentMonthRange();

	return new Promise((resolve, reject) => {
		const queryText = `SELECT category, SUM(amount) AS total_amount
                           FROM event
                           WHERE datetime >= $1 AND datetime <= $2
                           GROUP BY category`;
		pool.query(queryText, [startDate.format('YYYY-MM-DD HH:mm:ss'), endDate.format('YYYY-MM-DD HH:mm:ss')], (error, results) => {
			if (error) {
				reject(error);
			} else {
				resolve(results.rows);
			}
		});
	});
}

function getGroupedEventsForPreviousMonth() {
	const { startDate, endDate } = getCustomPreviousMonthRange();

	return new Promise((resolve, reject) => {
		const queryText = `SELECT category, SUM(amount) AS total_amount
                           FROM event
                           WHERE datetime >= $1 AND datetime <= $2
                           GROUP BY category`;
		pool.query(queryText, [startDate.format('YYYY-MM-DD HH:mm:ss'), endDate.format('YYYY-MM-DD HH:mm:ss')], (error, results) => {
			if (error) {
				reject(error);
			} else {
				resolve(results.rows);
			}
		});
	});
}

function createDbConnection() {
	return new Pool({
		host: properties.get("db.host"),
		port: properties.get("db.port"),
		user: POSTGRES_USER,
		password: POSTGRES_PASSWORD,
		database: TG_BOT_EXPENSES_DB_NAME,
		max: 10,
		idleTimeoutMillis: 30000,
	});
}

function formatDatetime(momentDatetime) {
	return momentDatetime.format('YYYY-MM-DD HH:mm:ss');
}

function formatDate(momentDate) {
	return momentDate.format('YYYY-MM-DD');
}

function saveLogToFile(log) {
	const logDirectory = './logs';
	const currentDate = moment();
	const currentMonth = currentDate.month() + 1;
	const currentYear = currentDate.year();
	const logFileName = `${currentYear}-${currentMonth}-${currentDate.format('D')}.log`;
	const logFilePath = path.join(logDirectory, logFileName);

	if (!fs.existsSync(logDirectory)) {
		fs.mkdirSync(logDirectory);
	}

	log = `[${formatDatetime(currentDate)}]: ${log}`;
	fs.appendFile(logFilePath, log + '\n', (err) => {
		if (err) {
			console.error('Error saving log to file:', err);
		}
	});
}

function sendScheduledReport() {
	getGroupedEventsForCustomMonth()
		.then((result) => {
			const { startDate, endDate } = getCustomCurrentMonthRange();
			let currentDay = moment().diff(startDate, 'days') + 1;
			let daysInCustomMonth = endDate.diff(startDate, 'days') + 1;

			let todayLimitGeneral = Math.round(limitGeneral / daysInCustomMonth * currentDay);
			let todayLimitFood = Math.round(limitFood / daysInCustomMonth * currentDay);
			let todayLimitFun = Math.round(limitFun / daysInCustomMonth * currentDay);

			let replyMessage = `Итоги на сегодня (${formatDate(moment())}):\n`;

			result.forEach(item => {
				if (item.category === CategoryType.FOOD.name) {
					replyMessage += getScheduledMessage(item.category, item.total_amount, limitFood, todayLimitFood);
				} else if (item.category === CategoryType.GENERAL.name) {
					replyMessage += getScheduledMessage(item.category, item.total_amount, limitGeneral, todayLimitGeneral);
				} else if (item.category === CategoryType.FUN.name) {
					replyMessage += getScheduledMessage(item.category, item.total_amount, limitFun, todayLimitFun);
				}
			})

			allowedUserIds.forEach(userId => {
				bot.sendMessage(userId, replyMessage)
					.then(() => {
						saveLogToFile("User with UID:[" + userId + "] received scheduled notification");
					})
					.catch((error) => {
						saveLogToFile("Ошибка на сервере при попытке отправить уведомление: " + error);
					});
			});
		})
		.catch((error) => {
			saveLogToFile("Ошибка на сервере при попытке отправить уведомление: " + error);
		});
}

function getScheduledMessage(category, totalAmount, limit, todayLimit) {
	let resolutionMessage = '';
	let difference  = todayLimit - totalAmount;
	let isBad = difference < 0;
	if (isBad) {
		resolutionMessage = `На ${Math.abs(difference)}$ > лимита на сегодня (${todayLimit}$)`;
	} else {
		resolutionMessage = `Отлично! На ${Math.abs(difference)}$ < лимита на сегодня (${todayLimit}$)`;
	}
	return `${isBad ? '💩' : '🎉'} По категории ${category} потрачено ${totalAmount}$ из ${limit}$. ${resolutionMessage}\n`;
}

function getCustomCurrentMonthRange() {
	let startDate;
	let endDate;

	if (moment().date() >= statementDay) {
		startDate = moment().date(statementDay).startOf('day');
		endDate = moment().add(1, 'month').date(statementDay - 1).endOf('day');
	} else {
		startDate = moment().subtract(1, 'month').date(statementDay).startOf('day');
		endDate = moment().date(statementDay - 1).endOf('day');
	}

	return { startDate, endDate };
}

function getCustomPreviousMonthRange() {
	let startDate;
	let endDate;

	startDate = moment().subtract(1, 'month').date(statementDay).startOf('day');
	endDate = moment().date(statementDay - 1).subtract(1, 'month').endOf('day');

	return { startDate, endDate };
}
