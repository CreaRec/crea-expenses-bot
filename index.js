const TelegramBot = require('node-telegram-bot-api');
const mysql = require('mysql2');
const propertiesReader = require('properties-reader');
const moment = require('moment');

const properties = propertiesReader('config.properties');

const pool = createDbConnection();

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

const EXPENSES = new Map();
EXPENSES.set(CategoryType.FOOD, 0);
EXPENSES.set(CategoryType.GENERAL, 0);
EXPENSES.set(CategoryType.FUN, 0);

const bot = new TelegramBot(properties.get("bot.apiKey"), {polling: true});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text;

    if (chatId && messageText) {
        console.log(messageText);

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
                    insertEvent(eventData);

                    sendReplyMessage(bot, chatId, 'Расход успешно добавлен!');
                    sendTotal(bot, chatId);
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
        });
}

function insertEvent(event) {
    pool.query('INSERT INTO event SET ?', event, (error, results, fields) => {
        if (error) {
            console.error(error);
        }
    });
}

function getEventsForCurrentMonth() {
    return new Promise((resolve, reject) => {
        // Get the current month and year
        const currentDate = new Date();
        const currentMonth = currentDate.getMonth() + 1; // Note: JavaScript months are zero-based
        const currentYear = currentDate.getFullYear();

        // Construct the SQL query to get events for the current month
        const sql = `SELECT category, SUM(amount) AS totalAmount
                     FROM event
                     WHERE MONTH(datetime) = ? AND YEAR(datetime) = ?
                     GROUP BY category`;

        // Execute the query
        pool.query(sql, [currentMonth, currentYear], (error, results) => {
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
