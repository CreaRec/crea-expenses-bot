const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2');
const propertiesReader = require('properties-reader');
const moment = require('moment');
const fs = require('fs');
const path = require('path');

const properties = propertiesReader('config.properties');

const pool = createDbConnection();

const allowedUserIds = properties.get("bot.allowedUsers").split(",").filter(Boolean);
const notifyUserIds = properties.get("bot.notifyUsers").split(",").filter(Boolean);

const CommandType = {
    FOOD: "/food",
    GENERAL: "/general",
    FUN: "/fun",
    TOTAL: "/total",
    PREV_TOTAL: "/prevTotal",
    START: "/start",
    CANCEL: "/cancel",
    HELP: "/help",
    REPORT: "/report"
}

const CategoryType = {
    FOOD: {
        name: 'FOOD',
        command: CommandType.FOOD
    },
    GENERAL: {
        name: 'GENERAL',
        command: CommandType.GENERAL
    },
    FUN: {
        name: 'FUN',
        command: CommandType.FUN
    }
};

const StateType = {
    START: 'START',
    ADDING: 'ADDING'
};

const states = {};
const categoryStates = {};

const bot = new TelegramBot(properties.get("bot.apiKey"), {polling: true});

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
                            sendAddConfirmationMessage(bot, chatId, result.insertId, eventData.amount, 'Расход успешно добавлен!');
                            sendTotal(bot, chatId);
                            sendNotifications(bot, eventData)
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
                    sendReplyMessage(bot, chatId, 'Ошибка на сервере!');
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

function sendAddConfirmationMessage(bot, chatId, eventId, amount, message) {
    const keyboard = {
        reply_markup: {
            inline_keyboard: [[
                {
                    text: 'Delete previous amount (' + amount + '$)',
                    callback_data: JSON.stringify({
                        command: 'delete',
                        amount: amount,
                        eventId: eventId
                    })
                }
            ]]
        }
    };

    bot.sendMessage(chatId, message, keyboard);
}

function sendNotifications(bot, eventData) {
    let currentUserId = eventData.user_id;
    let message = `Пользователь ${eventData.user_name} (${currentUserId}) добавила сумму ${eventData.amount} в категорию ${eventData.category}`
    notifyUserIds.filter(userId => parseInt(userId) !== currentUserId).forEach(userId => {
        bot.sendMessage(userId, message)
    })
}

function sendTotal(bot, chatId) {
    getGropedEventsForCurrentMonth()
        .then((result) => {
            let totalAmount = 0;
            let replyMessage = 'Расходы по категориям:\n';

            result.forEach(item => {
                replyMessage += `${item.category}: ${item.totalAmount}\n`;
                totalAmount += parseInt(item.totalAmount);
            })

            replyMessage += `Всего: ${totalAmount}`;
            sendReplyMessage(bot, chatId, replyMessage);
        })
        .catch((error) => {
            console.error('Error:', error);
            sendReplyMessage(bot, chatId, 'Ошибка на сервере!');
        });
}

function sendPrevTotal(bot, chatId) {
    getGropedEventsForPreviousMonth()
        .then((result) => {
            let totalAmount = 0;
            let replyMessage = 'Расходы по категориям за предыдущий месяц (' + (moment().subtract(1, 'month').month() + 1) + '):\n';

            result.forEach(item => {
                replyMessage += `${item.category}: ${item.totalAmount}\n`;
                totalAmount += parseInt(item.totalAmount);
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
    getEventsForCurrentMonth()
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
        pool.query('INSERT INTO event SET ?', event, (error, results, fields) => {
            if (error) {
                reject(error);
            } else {
                resolve(results);
            }
        });
    });
}

function deleteEvent(eventId) {
    return new Promise((resolve, reject) => {
        pool.query('DELETE FROM event WHERE id=?', eventId, (error, results, fields) => {
            if (error) {
                reject(error);
            } else {
                resolve(results);
            }
        });
    });
}

function getEventsForCurrentMonth() {
    return new Promise((resolve, reject) => {
        const currentDate = moment();
        const currentMonth = currentDate.month() + 1;
        const currentYear = currentDate.year();

        const sql = `SELECT * FROM event
                     WHERE MONTH (datetime) = ? AND YEAR (datetime) = ?`;

        pool.query(sql, [currentMonth, currentYear], (error, results) => {
            if (error) {
                reject(error);
            } else {
                resolve(results);
            }
        });
    });
}

function getGropedEventsForCurrentMonth() {
    return new Promise((resolve, reject) => {
        const currentDate = moment();
        const currentMonth = currentDate.month() + 1;
        const currentYear = currentDate.year();

        const sql = `SELECT category, SUM(amount) AS totalAmount
                     FROM event
                     WHERE MONTH (datetime) = ? AND YEAR (datetime) = ?
                     GROUP BY category`;

        pool.query(sql, [currentMonth, currentYear], (error, results) => {
            if (error) {
                reject(error);
            } else {
                resolve(results);
            }
        });
    });
}

function getGropedEventsForPreviousMonth() {
    return new Promise((resolve, reject) => {
        const prevDate = moment().subtract(1, 'month');
        const prevMonth = prevDate.month() + 1;
        const prevYear = prevDate.year();

        const sql = `SELECT category, SUM(amount) AS totalAmount
                     FROM event
                     WHERE MONTH (datetime) = ? AND YEAR (datetime) = ?
                     GROUP BY category`;

        pool.query(sql, [prevMonth, prevYear], (error, results) => {
            if (error) {
                reject(error);
            } else {
                resolve(results);
            }
        });
    });
}

function createDbConnection() {
    return mysql.createPool({
        host: properties.get("db.host"),
        port: properties.get("db.port"),
        user: properties.get("db.username"),
        password: properties.get("db.password"),
        database: properties.get("db.name"),
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
}

function formatDatetime(momentDatetime) {
    return momentDatetime.format('YYYY-MM-DD HH:mm:ss');
}

function saveLogToFile(log) {
    const logDirectory = './logs';
    const currentDate = moment();
    const currentMonth = currentDate.month() + 1;
    const currentYear = currentDate.year();
    const logFileName = `${currentYear}-${currentMonth}-${currentDate.format('D')}.log`;
    const logFilePath = path.join(logDirectory, logFileName);

    // Create the logs directory if it doesn't exist
    if (!fs.existsSync(logDirectory)) {
        fs.mkdirSync(logDirectory);
    }

    log = `[${formatDatetime(currentDate)}]: ${log}`
    // Append the log to the log file
    fs.appendFile(logFilePath, log + '\n', (err) => {
        if (err) {
            console.error('Error saving log to file:', err);
        }
    });
}
