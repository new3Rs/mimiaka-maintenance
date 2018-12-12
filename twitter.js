/* global exports */
const Twitter = require('twitter');

let MAX_CHARACTERS = 140;
let SHORT_URL_LENGTH = 23;
let SHORT_URL_LENGTH_HTTPS = 23;
const NO_PORT_URL_REGEXP = /https?:\/\/[a-zA-Z0-9-.]+(\/(%[0-9a-fA-F]{2}|[a-zA-Z0-9-_.!()])*)*(\?([a-zA-Z0-9-_.!()&=]|%[0-9a-fA-F]{2})+)*(\#([a-zA-Z0-9-_.~!$&'()\*\+,;=\/\?]|%[0-9a-fA-F]{2})+)*/g;

function textWithin140Chars(header, body, footer) {
    const status = header + body + footer;
    const urls = status.match(NO_PORT_URL_REGEXP);
    let { length } = status;
    if (urls != null) {
        for (let url of urls) {
            length -= url.length;
            length += /https/.test(url) ? SHORT_URL_LENGTH_HTTPS : SHORT_URL_LENGTH;
        }
    }
    if (length > MAX_CHARACTERS) {
        body = body.slice(0, MAX_CHARACTERS - length - 1) + '…';
    }
    return header + body + footer;
}

class MimiakaTwitter {
    constructor() {
        this.service = null;
        this.official = null;
    }

    async initialize(db) {
        const Services = db.collection('meteor_accounts_loginServiceConfiguration');
        const Users = db.collection('users');
        this.service = await Services.findOne({ service: 'twitter' });
        this.official = await Users.findOne(
            { 'services.twitter.screenName': process.env.HEROKU_APP_ID ? 'mimiaka1846' : 'test_bot1965' }
        );
        this.developer = await Users.findOne({ 'services.twitter.screenName': 'y_ich' });
    }

    async errorNotify(message) {
        /* sends error message */
        const twitter = new Twitter({
            consumer_key: this.service.consumerKey,
            consumer_secret: this.service.secret,
            access_token_key: this.official.services.twitter.accessToken,
            access_token_secret: this.official.services.twitter.accessTokenSecret,
            request_options: { json: true }
        });
        try {
            await twitter.post('direct_messages/events/new', { event: {
                type: 'message_create',
                message_create: {
                    target: { recipient_id: this.developer.services.twitter.id },
                    message_data: { text: message }
                }
            }});
        } catch (e) {
            console.log('errorNotify', e, this.official);
        }
    }

    // tweets status as user.
    async tweet(user, status, params = null) {
        if (user == null) {
            user = this.official;
        }
        if (!(user.services && user.services.twitter)) {
            return;
        }

        const p = Object.assign({ status }, params);
        try {
            const response = await new Twitter({
                consumer_key: this.service.consumerKey,
                consumer_secret: this.service.secret,
                access_token_key: user.services.twitter.accessToken,
                access_token_secret: user.services.twitter.accessTokenSecret
            }).post('statuses/update', p);
            return {
                statusCode: 200,
                data: response
            };
        } catch (e) {
            await this.errorNotify(`tweet: ${user.profile.name}, ${status}, ${e[0] && e[0].message}, ${e.stack}`);
            return e;
        }
    }

    async updateTwitterConstant(Constants) {
        const twitter = new Twitter({
            consumer_key: this.service.consumerKey,
            consumer_secret: this.service.secret,
            access_token_key: this.official.services.twitter.accessToken,
            access_token_secret: this.official.services.twitter.accessTokenSecret
        });
        const response = await twitter.get('help/configuration', {});
        if ((response != null) && (response.characters_reserved_per_media != null) && (response.short_url_length != null) && (response.short_url_length_https != null)) {
            await Constants.updateOne(
                { category: 'twitter' },
                {
                    $set: response,
                    $setOnInsert: { category: 'twitter' }
                },
                { upsert: true }
            );
        }
    }

    async updateProfileImageUrl(Users, user) {
        if (!(user.services.twitter && user.services.twitter.accessToken)) {
            return;
        }
        try {
            const twitter = new Twitter({
                consumer_key: this.service.consumerKey,
                consumer_secret: this.service.secret,
                access_token_key: user.services.twitter.accessToken,
                access_token_secret: user.services.twitter.accessTokenSecret
            });
            const response = await twitter.get('users/show', { user_id: user.services.twitter.id });
            await Users.updateOne({ 'services.twitter.id': user.services.twitter.id },
                { $set: { 'profile.profileImageUrl': response.profile_image_url }});
        } catch (e) {
            switch (e[0] && e[0].code) {
                case 32:
                case 89: // 'Could not authenticate you' or 'Invalid or expired token'
                    await Users.update({ 'services.twitter.id': user.services.twitter.id }, { $unset: {
                        'services.twitter.accessToken': '',
                        'services.twitter.accessTokenSecret': ''
                    }});
                    break;
                case 130: // 'Over capacity'
                    await this.errorNotify(`updateProfileImageUrl: ${user.profile.name}, ${JSON.stringify(e)}`);
                    return false;
                case 326: // 'To protect our users from spam and other malicious activity, this account is temporarily locked. Please log in to https://twitter.com to unlock your account.'
                    return true;
                default:
                    await this.errorNotify(`updateProfileImageUrl: ${user.profile.name}, ${JSON.stringify(e)}`);
                    return true;
            }
        }
        return true;
    }

    async updateAllProfileImageUrls(Users) {
        const users = await Users.find(
            { 'services.twitter.accessToken': { $exists: true }}
        ).toArray();
        for (const user of users) {
            if (!await this.updateProfileImageUrl(Users, user)) {
                break;
            }
        }
    }
}


exports.MimiakaTwitter = MimiakaTwitter;
exports.textWithin140Chars = textWithin140Chars;

const { MongoClient } = require('mongodb');
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
    await twitter.errorNotify('test');
}
if (require.main === module) {
    test().then(function() { process.exit() });
}