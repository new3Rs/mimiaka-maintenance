function createIndices(db) {
    db.createIndex('gameinfos', {
        DT: -1,
        createdAt: -1,
        club: 1,
        deleted: 1,
        live: 1,
        record: 1
    });
    db.createIndex('news', { date: -1 });
    db.createIndex('players', { rank: 1 });
    db.createIndex('players', { rankChange: -1 });
    db.createIndex('players', { age: 1 });
    db.createIndex('players', { organization: 1 });
    db.createIndex('problems', {
        book: 1,
        index: 1
    });
    db.createIndex('records', {
        pickup: -1,
        live: -1
    },  {sparse: true });
    db.createIndex('records', {
        live: 1,
        club: 1,
        deleted: 1
    });
    db.createIndex('constants', { category: 1 });
    db.createIndex('seats', { browserId: 1 });
    db.createIndex('seats', { mobile: 1 });
    db.createIndex('chats', { recordId: 1 });
    db.createIndex('simulations', { recordId: 1 });
}

exports.createIndices = createIndices;