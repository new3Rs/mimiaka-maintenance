#!/usr/bin/env node
/* global module */
// Mimiaka: Internet live relay of Go professional games
// (C) 2013-2014 ICHIKAWA, Yuji (New 3 Rs)

const { MongoClient } = require('mongodb');
const { isLive } = require('mimiaka');
const { MimiakaTwitter } = require('./twitter.js');
const { updateArticles } = require('./news.js');
const { updateRanking } = require('./players.js');
const { createIndices } = require('./create_indices.js');

function choice(array) {
    return array[Math.floor(Math.random() * array.length)];
}

async function endLives(db) {
    /* cleans up ended live games */
    const Records = db.collection('records');
    const GameInfos = db.collection('gameinfos');
    const Constants = db.collection('constants');
    const Chats = db.collection('chats');
    const Simulations = db.collection('simulations');
    const Forecasts = db.collection('forecasts');
    const records = await Records.find({
        live: true,
        club: { $ne: true }
    }).toArray();
    for (const e of records) {
        if (!isLive(e.sgf)) {
            const $set = {};
            const chats = await Chats.findOne({ recordId: e._id });
            if (chats != null) {
                delete chats.recordId;
                $set.chats = chats;
            }
            const simulations = await Simulations.findOne({ recordId: e._id });
            if (simulations != null) {
                delete simulations.recordId;
                $set.simulations = simulations;
            }
            const forecast = await Forecasts.findOne({ recordId: e._id });
            if (forecast != null) {
                delete forecast.recordId;
                $set.forecast = forecast;
            }
            const modifier = { $unset: {
                live: '',
                tweetedAt: ''
            }};
            if (Object.keys($set).length > 0) {
                modifier.$set = $set;
            }
            await Records.updateOne({ _id: e._id }, modifier);
            // 耳赤でobserveが動いているはずだけど、スリープしている可能性があるのでここで更新する
            await GameInfos.updateOne(
                { record: e._id },
                { $unset: { live: '' }}
            );
        }
    }
    await Constants.updateOne(
        { category: 'youtube' },
        {
            $unset: { id: '' },
            $setOnInsert: { category: 'youtube' }
        },
        { upsert: true }
    );
}

function getToday() {
    const today = new Date(Date.now() - (-9 * 60 - new Date().getTimezoneOffset()) * 60000).toISOString();
    const match = today.match(/([0-9]+)-(.*)T/);
    return match.slice(1, 3);
}

async function updatePickup(db, twitter) {
    const GameInfos = db.collection('gameinfos');
    const Constants = db.collection('constants');
    const [thisYear, today] = getToday();
    const todays_records = await GameInfos.find({
        deleted: { $ne: true },
        live: { $ne: true },
        club: { $ne: true },
        record: { $exists: true },
        GN: { $not: /AlphaGo.*vs/ },
        DT: { $regex: new RegExp(`(?<!^${thisYear})-${today}`) }
    }).toArray();
    if (todays_records.length > 0) {
        const c = choice(todays_records);
        await Constants.updateOne(
            { category: 'pickup' },
            {
                $set: { recordId: c.record },
                $setOnInsert: { category: 'pickup' }
            },
            { upsert: true }
        );
        const interval = parseInt(thisYear) - parseInt(c.DT.replace(/-.*/, ''));
        const text = `今日の一局は${c.GN || c.EV}です。本局は${interval}年前の今日打たれました。 #棋譜並べ会 https://mimiaka.herokuapp.com/`;
        // await twitter.tweet(null, text);
        await twitter.errorNotify(text);
    } else {
        const pickups = await GameInfos.find({
            deleted: { $ne: true },
            live: { $ne: true },
            club: { $ne: true },
            pickup: true
        }).toArray();
        const c = choice(pickups);
        await Constants.updateOne(
            { category: 'pickup' },
            {
                $set: { recordId: c.record },
                $setOnInsert: { category: 'pickup' }
            },
            { upsert: true }
        );
    }
}


async function dailyMaintenance() {
    const client = await MongoClient.connect(process.env.HEROKU_APP_ID ?  // TODO - DYNO is experimental
        process.env.MIMIAKA_MONGO_URL : 'mongodb://localhost:3001');
    const db = client.db(process.env.HEROKU_APP_ID ? 'mimiaka' : 'meteor');
    const twitter = new MimiakaTwitter();
    try {
        await twitter.initialize(db);
    } catch (e) {
        console.log('twitter.initialize', e);
    }
    try {
        await endLives(db);
    } catch (e) {
        console.log('endLives', e);
    }
    const Constants = db.collection('constants');
    try {
        await twitter.updateTwitterConstant(Constants);
    } catch (e) {
        console.log('twitter.updateTwitterConstant', e);
    }
    const Users = db.collection('users');
    try {
        await twitter.updateAllProfileImageUrls(Users);
    } catch (e) {
        console.log('twitter.updateAllProfileImageUrls', e);
    }
    try {
        await updateArticles(db, twitter);
    } catch (e) {
        console.log('updateArticles', e);
    }
    const Players = db.collection('players');
    try {
        await updateRanking(Players, twitter);
    } catch (e) {
        console.log('updateRanking', e);
    }
    try {
        await updatePickup(db, twitter);
    } catch (e) {
        console.log('updatePickup', e);
    }
    try {
        createIndices(db);
    } catch (e) {
        console.log('createIndices', e);
    }
    await client.close();
}

if (require.main === module) {
    dailyMaintenance().catch(function(reason) {
        console.log(reason);
    });
}
