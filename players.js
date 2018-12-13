/* global exports */
// Mimiaka: Internet live relay of Go professional games
// (C) 2013-2014 ICHIKAWA, Yuji (New 3 Rs)
/*
Players
*/

const rp = require('request-promise-native');
const cheerio = require('cheerio');

function addUpdatedProperty(set, player, key, value) {
    if (player[key] !== value) {
        set[key] = value;
    }
}

async function _updateRanking(Players, twitter) {
    /* update Players */
    const MAMUMAMU_URL = 'http://sports.geocities.jp/mamumamu0413/total.html';
    let changed = false;
    try {
        var $ = cheerio.load(await rp(MAMUMAMU_URL, {followRedirects: false}));
    } catch (e) {
        await twitter.errorNotify(`updateRanking: ${e.stack}`);
        return changed;
    }

    const time = Date.now();
    const heads = $('#anyid tr:first-child th').map(function() {
        return $(this).text().trim();
    }).toArray();
    const $tr = $('#anyid tr:not(:first-child)');
    const $list = $tr.map(function() {
        return $(this).children('td').map(function() {
            return $(this).text().trim();
        });
    });
    for (const e of $list.toArray())  {
        if (e.length == 0) {
            continue;
        }
        const player = await Players.findOne({ mamumamuName: e[heads.indexOf('氏名')] }) || {};
        const update = { updatedAt: time };
        const rank = parseInt(e[heads.indexOf('順位')]);
        addUpdatedProperty(update, player, 'rank', rank);
        addUpdatedProperty(update, player, 'mamumamuName', e[heads.indexOf('氏名')]);
        addUpdatedProperty(update, player, 'organization', e[heads.indexOf('所属')]);
        if (!/^\s*$/.test(e[heads.indexOf('性別')])) {
            addUpdatedProperty(update, player, 'sex', e[heads.indexOf('性別')]);
        }
        const age = parseFloat(e[heads.indexOf('年齢')]);
        if (!isNaN(age)) {
            addUpdatedProperty(update, player, 'age', age);
        }
        const rating = parseFloat(e[heads.indexOf('レーティング')]);
        addUpdatedProperty(update, player, 'rating', rating);
        let rankChange = e[heads.indexOf('順位変動')];
        let match;
        if (rankChange === '-') {
            rankChange = 0;
        } else if ((match = rankChange.match(/([↑↓])(\d+)/))) {
            rankChange = parseInt(match[2]);
            if (match[1] === '↓') {
                rankChange = - rankChange;
            }
        } else {
            rankChange = 0;
        }
        addUpdatedProperty(update, player, 'rankChange', rankChange);
        let ratingChange = parseFloat(e[heads.indexOf('レーティング変動')]);
        if (!isNaN(ratingChange)) {
            addUpdatedProperty(update, player, 'ratingChange', ratingChange);
        }
        if (Object.keys(update).length > 1) {
            console.log(e[heads.indexOf('氏名')], update);
            if (player._id != null) {
                await Players.updateOne({ _id: player._id }, { $set: update });
            } else {
                await Players.insertOne(update);
            }
            changed = true;
        }
    }
    if (changed) {
        await Players.updateMany({ updatedAt: { $ne: time }}, { $set: {
            rank: null,
            updatedAt: time
        }});
    }
    return changed;
}

async function tweetRankingUpdate(Players, twitter) {
    let hotPlayers = await Players.find({ rank: { $lt: 200 }}, {
        sort: {
            ratingChange: -1
        },
        limit: 3
    }).toArray();
    hotPlayers = hotPlayers.map(e => (e.name || e.mamumamuName) + `(${e.rank}位)`);
    let hotWomen = await Players.find({
        rank: { $lt: 500 },
        sex: 'F'
    }, {
        sort: { ratingChange: -1 },
        limit: 3
    }).toArray();
    hotWomen = hotWomen.map(e => (e.name || e.mamumamuName) + `(${e.rank}位)`);
    const status = `ランキング表更新しました。
https://mimiaka.herokuapp.com/ranking
注目の棋士は${hotPlayers.join(',')}、注目の女流棋士は${hotWomen.join(',')}です！`;
    // await twitter.tweet(null, status);
    await twitter.errorNotify(status);
}

async function updateRanking(Players, twitter) {
    if (await _updateRanking(Players, twitter)) {
        await tweetRankingUpdate(Players, twitter);
    }
}

exports.updateRanking = updateRanking;

const { MongoClient } = require('mongodb');
const { MimiakaTwitter } = require('./twitter');

async function test() {
    const client = await MongoClient.connect(process.env.HEROKU_APP_ID ?  // TODO - DYNO is experimental
        process.env.MIMIAKA_MONGO_URL : 'mongodb://localhost:3001', { useNewUrlParser: true });
    const db = client.db(process.env.HEROKU_APP_ID ? 'mimiaka' : 'meteor');
    const twitter = new MimiakaTwitter();
    try {
        await twitter.initialize(db);
    } catch (e) {
        console.log('twitter.initialize', e);
    }

    const Players = db.collection('players');
    try {
        await updateRanking(Players, twitter);
    } catch (e) {
        console.log('updateRanking', e);
    }
}

if (require.main === module) {
    test().catch(function(e) {
        console.log(e);
    }).then(function() {
        process.exit();
    });
}