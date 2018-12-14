/* global exports */
// (C) 2015 ICHIKAWA, Yuji (New 3 Rs)

const rp = require('request-promise-native');
const iconv = require('iconv-lite');
const cheerio = require('cheerio');
const xml2js = require('xml2js');
const _ = require('underscore');
const { dateString, twoDigits } = require('mimiaka');
const { textWithin140Chars } = require('./twitter.js');

function japaneseDateString(date) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

async function asahiArticles(News, twitter) {
    const texts = [];
    const today = new Date(Date.now() + (9 * 60 * 60 * 1000));
    const URL = 'http://www.asahi.com/shimen/' +
        dateString(today).replace(/-/g, '') +
        '/index_tokyo_list.html';
    try {
        const content = await rp(URL, { followRedirects: false });
        const $ = cheerio.load(content);
        const $igoshogi = $('#MainInner .Section').filter(function() {
            return /碁将棋/.test($(this).find('.ListTitle').text());
        });
        if ($igoshogi.length === 0) {
            await twitter.errorNotify("朝日新聞のフォーマットが変わったかも");
        }
        for (const e of $igoshogi.find('.List li:not(.Image)').toArray()) {
            const $this = $(e);
            const title = $this.text();
            const url = `https://www.asahi.com${$this.find('a').attr('href')}`;
            if ((/囲碁/.test(title)) && (await News.find({url}).count() === 0)) {
                const $$ = cheerio.load(await rp(url, {followRedirects: false}));
                const $date = $$('#MainInner .LastUpdated');
                const $articleText = $$('#MainInner .ArticleText');
                const match = $date.text().match(/([0-9]+)年([0-9]+)月([0-9]+)日/);
                const date = new Date(match[1], match[2] - 1, match[3], 0, 0, 0, 0);
                await News.insertOne({
                    title,
                    url,
                    date: dateString(date)
                });
                texts.push(textWithin140Chars(
                    title + '\n',
                    $articleText.text()
                        .replace(/\n\s+/g, '\n')
                        .replace('（６目半コミ出し）\n＊\n', ''),
                    '\n' + url
                ));
            }
        }
    } catch (e) {
        await twitter.errorNotify("朝日新聞のアドレスが変わったかも");
    }
    return texts;
}

async function mainichiArticles(News, twitter) {
    const URL = 'http://mainichi.jp/igo/';
    const texts = [];
    try {
        const $ = cheerio.load(await rp(URL, {followRedirects: false}));
        for (const e of $('.newslist .main-box .list-typeD > li').toArray()) {
            const $this = $(e);
            const match = $this.find('.date').text().match(/([0-9]+)年([0-9]+)月([0-9]+)日/);
            const $title = $this.find('a');
            const url = `http://mainichi.jp${$title.attr('href')}`;
            const title = $title.text();
            const articleText = $this.find('.txt').text();
            if ((/(第[０-９]+局の[０-９]+|第[０-９]+譜)/.test(title)) && (News.find({url}).count() === 0)) {
                await News.insertOne({
                    title,
                    url,
                    date: `${match[1]}-${match[2]}-${match[3]}`
                });
                texts.push(textWithin140Chars(`${title}\n`, articleText.replace(/\n\s+/g, '\n'), `\n${url}`));
            }
        }
    } catch (e) {
        console.log('mainichiArticles', e);
        await twitter.errorNotify("毎日新聞のアドレスが変わったかも");
    }
    return texts;
}

async function nhkTextView(News, twitter) {
    const URL = 'http://textview.jp/feed';
    const texts = [];
    try {
        const content = await rp(URL, { followRedirects: false });
        const { rss } = await new Promise(function(res, rej) {
            xml2js.parseString(content, function(err, result) {
                if (err) {
                    rej(err);
                } else {
                    res(result);
                }
            });
        });
        for (const item of rss && rss.channel && rss.channel[0] && rss.channel[0].item || []) {
            if (item.category && item.category.indexOf('囲碁講座') >= 0) {
                const url = item.link;
                const title = item.title[0].trim();
                const articleText = _.unescape(item.description[0].trim()).replace(/&#[0-9]+;/, '');
                const date = new Date(item.pubDate[0]);
                if (await News.find({ url }).count() === 0) {
                    await News.insertOne({
                        title,
                        url,
                        date: dateString(date)
                    });
                    texts.push(textWithin140Chars(`「${title}」\n`, articleText.replace(/\n\s+/g, '\n'), `\n${url}`));
                }
            }
        }
    } catch (e) {
        console.log('nhkTextView', e);
        await twitter.errorNotify("NHKテキストビューのアドレスが変わったかも");
    }
    return texts;
}

async function ironnaArticles(News, twitter) {
    const URL = 'http://ironna.jp/search/tag/%E3%82%B2%E3%83%BC%E3%83%A0';
    const texts = [];
    try {
        const $ = cheerio.load(await rp(URL, {followRedirects: false}));
        for (const e of $('#search-results li').toArray()) {
            const $this = $(e);
            const $title = $this.find('h1 a');
            const url = `http://ironna.jp${$title.attr('href')}`;
            const title = $title.text();
            const articleText = $this.find('.word').text();
            if (articleText.indexOf('碁') >= 0) {
                if (await News.find({url}).count() === 0) {
                    await News.insertOne({
                        title,
                        url
                    });
                    texts.push(textWithin140Chars(`${title}\n`, articleText.replace(/\n\s+/g, '\n'), `\n${url}`));
                }
            }
        }
    } catch (e) {
        console.log('ironnaArticles', e);
        await twitter.errorNotify("iRONNAのアドレスが変わったかも");
    }
    return texts;
}

async function gameResults(News, GameInfos, twitter) {
    const URL = 'http://njk.nihonkiin.or.jp/UI/01INFO/news.php';
    const texts = [];
    try {
        const html = iconv.decode(await rp(URL, {
            followRedirects: false,
            encoding: null
        }), 'EUC-JP');
        const $ = cheerio.load(html);
        const match = $('body div:first-child').text().match(/更新日時：([0-9]{4}-[0-9]{2}-[0-9]{2})/);
        const title = '先週の主な対局結果';
        if (match != null) {
            const latest = await News.findOne({ title }, { sort: { date: -1 }});
            const date = new Date(match[1]);
            if (date.getTime() > new Date(latest && latest.date || '2000-01-01').getTime()) {
                await News.insertOne({
                    title,
                    date: match[1],
                    html
                });
                texts.push(title + '\n' + URL);
                await registerGameResults(GameInfos, date, $, $('body table').eq(1), twitter);
            }
        } else {
            await twitter.errorNotify("先週の主な対局結果のフォーマットが変わったかも");
        }
    } catch (e) {
        console.log(e);
        await twitter.errorNotify("先週の主な対局結果のアドレスが変わったかも");
    }
    return texts;
}

function hankaku(text) {
    return text.replace(/[０-９Ａ-Ｚａ-ｚ]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
}

async function sgfResult(text, twitter) {
    let match;
    if (text === '不戦勝') {
        return 'B+Default';
    }
    let re = text.charAt(0) === '黒' ? 'B+' : 'W+';
    re += /中押/.test(text) ?
        'R'
    : /時間/.test(text) ?
        'T'
    : /反則/.test(text) ?
        'F'
    : /半目/.test(text) ?
        '0.5'
    : (match = text.match(/([0-9０-９]+)(?:目半|点)/)) ?
        `${hankaku(match[1])}.5`
    :
        (await twitter.errorNotify(`sgfResult: 勝敗の詳細が不明${text}`),
        text.slice(1));
    return re;
}

async function registerGameResults(GameInfos, updateDate, $, $table, twitter) {
    const year = updateDate.getFullYear();
    let dt;
    for (const elem of $table.find('tr').toArray()) {
        const $elem = $(elem);
        const $td = $elem.find('td');
        let pb, br, pw, wr;
        if ($td.length === 1) {
            const match = $td.text().match(/([0-9]{1,2})月([0-9]{1,2})日/);
            if (match != null) {
                const d = new Date(updateDate.getTime());
                const month = parseInt(match[1]);
                const date = parseInt(match[2]);
                d.setMonth(month - 1);
                d.setDate(date);
                dt = d.getTime() > updateDate.getTime() ?
                    `${year - 1}-${twoDigits(month)}-${twoDigits(date)}`
                :
                    `${year}-${twoDigits(month)}-${twoDigits(date)}`;
            }
            continue;
        } else if ($td.length !== 6) {
            await twitter.errorNotify(`registerGameResults: フォーマットが違う ${$td.text()}`);
            continue;
        }
        if (/△/.test($td.eq(1).text()) || $td.eq(3).text() === '不戦勝' || $td.eq(3).text() === '無勝負') {
            [pb, br] = $td.eq(2).text().split(/\s+/);
            [pw, wr] = $td.eq(5).text().split(/\s+/);
        } else if (/△/.test($td.eq(4).text())) {
            [pb, br] = $td.eq(5).text().split(/\s+/);
            [pw, wr] = $td.eq(2).text().split(/\s+/);
        } else {
            await twitter.errorNotify(`registerGameResults: 黒番白番がわからない ${$td.text()}`);
            continue;
        }
        if (!dt) {
            await twitter.errorNotify('registerGameResults: 日付がわからない');
            continue;
        }
        await GameInfos.updateOne({
            GN: $td.eq(0).text(),
            PB: pb,
            BR: br,
            PW: pw,
            WR: wr,
            KM: '6.5'
        }, {
            $set: {
                DT: dt,
                RE: await sgfResult($td.eq(3).text(), twitter)
            },
            $setOnInsert: {
                GN: $td.eq(0).text(),
                PB: pb,
                BR: br,
                PW: pw,
                WR: wr,
                KM: '6.5'
            }
        }, { upsert: true });
    }
}

async function updateFromGameResult(last, GameInfos, News, twitter) {
    const news = await News.find({ title: '先週の主な対局結果' }).toArray();
    for (const doc of news) {
        const date = new Date(doc.date);
        if (date > last) {
            console.log(doc.title);
            const $ = cheerio.load(doc.html);
            await registerGameResults(GameInfos, date, $, $('body table').eq(1), twitter);
        }
    }
}

async function updateArticles(db, twitter) {
    const News = db.collection('new');
    const GameInfos = db.collection('gameinfos');
    let texts = [];
    const today = new Date(Date.now() + (9 * 60 * 60 * 1000));
    // 棋聖戦
    texts = texts.concat(await asahiArticles(News, twitter)); // 名人戦
    texts = texts.concat(await mainichiArticles(News, twitter)); //本因坊戦
    // 王座戦
    // 天元戦
    // 碁聖戦
    // 十段戦
    texts = texts.concat(await nhkTextView(News, twitter)); //NHKテキストビュー
    texts = texts.concat(await ironnaArticles(News, twitter)); //iRONNA「ゲーム」タグ
    texts = texts.concat(await gameResults(News, GameInfos, twitter)); // 日本棋院
    // texts = texts.concat(sinaArticles()); // 新浪体育 jack-bauerに移した

    const status = today.getUTCHours() < 12 ?
        'おはようございます。\n' + (texts.length > 0 ?
            `${japaneseDateString(today)}朝の観戦記は${texts.length}件です。`
        :
            `${japaneseDateString(today)}朝は観戦記の更新がありませんでした。`
        ) + '\n皆様、今日も良い一日を♫'
    :
        'こんばんは。\n' + (texts.length > 0 ?
            `${japaneseDateString(today)}夕方の観戦記は${texts.length}件です。`
        :
            `${japaneseDateString(today)}夕方は観戦記の更新がありませんでした。`
        ) + '\n皆様、今夜も良い一時を☆';

    await twitter.tweet(null, status);
    for (const text of texts) {
        await twitter.tweet(null, text);
    }
}

exports.updateArticles = updateArticles;
exports.updateFromGameResult = updateFromGameResult;
