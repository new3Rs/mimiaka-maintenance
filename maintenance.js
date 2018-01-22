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
    const youtube = await Constants.findOne({ category: 'youtube' });
    await Constants.updateOne({ _id: youtube._id }, { $unset: { id: '' }});
}


async function updatePickup(db) {
    const Records = db.collection('records');
    const Constants = db.collection('constants');

    const pickups = await Records.find({
        deleted: { $ne: true },
        pickup: true,
        live: { $ne: true }
    }, { fields: { _id: 1 }}).toArray();
    if (pickups.length == 0) {
        return;
    }
    await Constants.update(
        { category: 'pickup' },
        {
            $set: { recordId: choice(pickups)._id },
            $setOnInsert: { category: 'pickup' }
        },
        { upsert: true }
    );
}


async function dailyMaintenance() {
    const client = await MongoClient.connect(process.env.HEROKU_APP_NAME ?
        process.env.MONGO_URL : 'mongodb://localhost:3001');
    const db = client.db('meteor');
    try {
        await endLives(db);
    } catch (e) {
        console.log('endLives', e);
    }
    try {
        await updatePickup(db);
    } catch (e) {
        console.log('updatePickup', e);
    }
    const twitter = new MimiakaTwitter();
    await twitter.initialize(db);
    try {
        const Constants = db.collection('constants');
        await twitter.updateTwitterConstant(Constants);
        const Users = db.collection('users');
        await twitter.updateAllProfileImageUrls(Users);
    } catch (e) {
        console.log('updateTwitterConstant', e);
    }
    try {
        await updateArticles(db, twitter);
    } catch (e) {
        console.log('updateArticles', e);
    }
    try {
        const Players = db.collection('players');
        await updateRanking(Players, twitter);
    } catch (e) {
        console.log('updateRanking', e);
    }
    await client.close();
}

if (require.main === module) {
    dailyMaintenance();
}
