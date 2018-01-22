import fs from 'fs';
import cheerio from 'cheerio';
import { describe, it } from 'meteor/practicalmeteor:mocha';
import { chai } from 'meteor/practicalmeteor:chai';
import { registerGameResults } from './helpers.js';

describe('functions', () =>
    describe('registerGameResults', () =>
        it('should show output process', function() {
            const html = fs.readFileSync('/Users/yuji/Projects/mimiaka-chat/imports/api/news/helpers.test.html');
            const $ = cheerio.load(html);
            registerGameResults(new Date(), $, $('body table').eq(1));
            return chai.assert.ok(true);
        })
    )
);
