const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

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

const token = fs.readFileSync('api-key.txt', 'utf8').trim();
const bot = new TelegramBot(token, { polling: true });

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

                    if (EXPENSES.has(categoryType)) {
                        const currentAmount = EXPENSES.get(categoryType);
                        EXPENSES.set(categoryType, currentAmount + amount);
                    } else {
                        sendReplyMessage(bot, chatId, 'Такой категории не существует!');
                        return;
                    }

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
                    { text: CategoryType.FOOD.command },
                    { text: CategoryType.GENERAL.command },
                    { text: CategoryType.FUN.command }
                ],
                [
                    { text: '/total' },
                    { text: '/cancel' }
                ]
            ]
        }
    };

    bot.sendMessage(chatId, message, keyboard);
}

function sendTotal(bot, chatId) {
    let totalAmount = 0;
    let replyMessage = 'Расходы по категориям:\n';

    for (const [category, amount] of EXPENSES) {
        replyMessage += `${category.name}: ${amount}\n`;
        totalAmount += amount;
    }

    replyMessage += `Всего: ${totalAmount}`;
    sendReplyMessage(bot, chatId, replyMessage);
}
