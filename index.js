const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2');
const propertiesReader = require('properties-reader');
const moment = require('moment');

const properties = propertiesReader('config.properties');

const pool = createDbConnection();

const allowedUserIds = properties.get("bot.allowedUsers").split(",");

const CategoryType = {
    FOOD: {
        name: 'FOOD',
        command: '/food'
    },
    GENERAL: {
        name: 'GENERAL',
        command: '/general'
    },
    FUN: {
        name: 'FUN',
        command: '/fun'
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

    console.log("UID:[" + userId + "] - MSG:[" + messageText + "]");

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
        } else if (messageText === '/total') {
            sendTotal(bot, chatId);
        } else if (messageText === '/prevTotal') {
            sendPrevTotal(bot, chatId);
        } else if (messageText === '/cancel' || messageText === '/start') {
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
                        datetime: formatDatetime(moment())
                    };
                    insertEvent(eventData)
                        .then((result) => {
                            sendReplyMessage(bot, chatId, 'Расход успешно добавлен!');
                            sendTotal(bot, chatId);
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
                    {text: '/total'},
                    {text: '/cancel'}
                ]
            ]
        }
    };

    bot.sendMessage(chatId, message, keyboard);
}

function sendTotal(bot, chatId) {
    getEventsForCurrentMonth()
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
    getEventsForPreviousMonth()
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

function getEventsForCurrentMonth() {
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

function getEventsForPreviousMonth() {
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
