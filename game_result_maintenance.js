/* global module */

const { MongoClient } = require('mongodb');
const { MimiakaTwitter } = require('./twitter.js');
const { updateFromGameResult } = require('./news.js');

async function maintenance() {
    const client = await MongoClient.connect('mongodb://mimiaka:mimiaka1846@ds023668-a0.mlab.com:23668,ds023668-a1.mlab.com:23668/mimiaka?replicaSet=rs-ds023668');
    const db = client.db('mimiaka');
    const twitter = new MimiakaTwitter();
    const News = db.collection('new');
    const GameInfos = db.collection('gameinfos');
    const last = new Date(2018, 0, 22);
    await updateFromGameResult(last, GameInfos, News, twitter);
}

if (require.main === module) {
    maintenance();
}
