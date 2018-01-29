#!/usr/bin/env node
/* global module */
// Mimiaka: Internet live relay of Go professional games
// (C) 2013-2014 ICHIKAWA, Yuji (New 3 Rs)

const { MongoClient } = require('mongodb');
const { isLive } = require('mimiaka');
const { MimiakaTwitter } = require('./twitter.js');
const { updateArticles } = require('./news.js');
const { updateRanking } = require('./players.js');


function choice(array) {
    return array[Math.floor(Math.random() * array.length)];
}

async function endLives(db) {
    /* cleans up ended live games */
    const Records = db.collection('records');
    const GameInfos = db.collection('gameinfos');
    const Constants = db.collection('constants');
    const records = await Records.find({
        live: true,
        club: { $ne: true }
    }).toArray();
    for (const e of records) {
        if (!isLive(e.sgf)) {
            await Records.updateOne(
                { _id: e._id },
                { $unset: {
                    live: '',
                    tweetedAt: ''
                }}
            );
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
    const match = today.match(/-(.*)T/);
    return match[1];
}

async function updatePickup(db, twitter) {
    const GameInfos = db.collection('gameinfos');
    const Constants = db.collection('constants');
    const todays_records = await GameInfos.find({
        deleted: { $ne: true },
        DT: { $regex: new RegExp(getToday()) }
    }).toArray();
    if (todays_records.length == 0) {
        return;
    }
    const c = choice(todays_records);
    await Constants.updateOne(
        { category: 'pickup' },
        {
            $set: { recordId: c.record },
            $setOnInsert: { category: 'pickup' }
        },
        { upsert: true }
    );
    const text = `今日の一局は${c.GN}です。 #棋譜並べ会 https://mimiaka.herokuapp.com/`;
    await twitter.tweet(null, text);
}


async function dailyMaintenance() {
    const client = await MongoClient.connect(process.env.HEROKU_APP_ID ?  // TODO - DYNO is experimental
        process.env.MIMIAKA_MONGO_URL : 'mongodb://localhost:3001');
    const db = client.db(process.env.HEROKU_APP_ID ? 'mimiaka' : 'meteor');
    const twitter = new MimiakaTwitter();
    await twitter.initialize(db);
    await endLives(db);
    await updatePickup(db, twitter);
    const Constants = db.collection('constants');
    await twitter.updateTwitterConstant(Constants);
    const Users = db.collection('users');
    await twitter.updateAllProfileImageUrls(Users);
    await updateArticles(db, twitter);
    const Players = db.collection('players');
    await updateRanking(Players, twitter);
    await client.close();
}

if (require.main === module) {
    dailyMaintenance().catch(function(reason) {
        console.log(reason);
    });
}
