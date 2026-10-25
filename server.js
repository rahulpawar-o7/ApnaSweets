// ApnaSweets backend - Node.js + MongoDB Atlas

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const tls = require('tls');
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT || 3000;

const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const UP = path.join(DATA, 'uploads');
const DB = path.join(DATA, 'db.json');
const PUB = path.join(__dirname, 'public');

const STATUS = ['Pending', 'Ongoing', 'Delivered'];
const CATS = ['Barfi', 'Laddoo', 'Syrup Sweets', 'Festive Boxes'];
const UNITS = ['per kg', 'per 500 g', 'per piece', 'per box'];

const G = {
  'per kg': 1000,
  'per 500 g': 500
};

const n3 = x => Math.round(x * 1000) / 1000;

const okQ = (p, q) =>
  G[p.unit]
    ? q * G[p.unit] >= 10
    : q >= 0.5 && Number.isInteger(q * 2);

const TEMP_PW = 'sweets123';
const tries = new Map();

fs.mkdirSync(UP, { recursive: true });

// MongoDB configuration
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'apnasweets';

if (!MONGODB_URI) {
  console.error(
    'MONGODB_URI is missing. Configure MongoDB Atlas environment variables.'
  );
  process.exit(1);
}

const mongoClient = new MongoClient(MONGODB_URI, {
  serverSelectionTimeoutMS: 15000
});

let mongoDb;
let stateCollection;
let db;

// Password helpers
const hash = (
  pw,
  salt = crypto.randomBytes(16).toString('hex')
) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');

const same = (a, b) =>
  a.length === b.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const checkPw = (pw, h) =>
  same(hash(pw, h.split(':')[0]), h);

const sha = s =>
  crypto.createHash('sha256').update(s).digest('hex');

// Save complete application state in MongoDB
async function save() {
  if (!stateCollection || !db) {
    throw new Error('MongoDB is not initialized');
  }

  await stateCollection.replaceOne(
    { _id: 'main' },
    {
      _id: 'main',
      data: db
    },
    { upsert: true }
  );
}

// Initialize MongoDB and migrate existing JSON data if necessary
async function initDb() {
  await mongoClient.connect();

  mongoDb = mongoClient.db(MONGODB_DB);
  stateCollection = mongoDb.collection('app_state');

  const saved = await stateCollection.findOne({
    _id: 'main'
  });

  if (saved && saved.data) {
    db = saved.data;
    console.log('Application data loaded from MongoDB.');
  } else if (fs.existsSync(DB)) {
    try {
      db = JSON.parse(fs.readFileSync(DB, 'utf8'));
      console.log('Existing JSON data imported into MongoDB.');
    } catch (error) {
      throw new Error(
        'Could not read existing db.json. Original data was not overwritten. ' +
        error.message
      );
    }
  } else {
    const seed = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8')
    );

    db = {
      ...seed,
      orders: [],
      moves: [],
      seq: 1,
      created: Date.now(),
      sessions: {},
      admin: {
        email: (
          process.env.ADMIN_EMAIL || 'owner@apnasweets.in'
        ).toLowerCase(),
        hash: hash(
          process.env.ADMIN_PASSWORD || TEMP_PW
        ),
        done: !!process.env.ADMIN_PASSWORD
      }
    };

    console.log('New application data initialized from seed.json.');
  }

  db.sessions = db.sessions || {};
  db.created = db.created || Date.now();

  if (db.admin.done === undefined) {
    db.admin.done = !checkPw(TEMP_PW, db.admin.hash);
  }

  if (
    process.env.RESET_ADMIN === '1' &&
    process.env.ADMIN_EMAIL &&
    process.env.ADMIN_PASSWORD
  ) {
    db.admin = {
      email: process.env.ADMIN_EMAIL.toLowerCase(),
      hash: hash(process.env.ADMIN_PASSWORD),
      done: true,
      otp: false
    };

    db.sessions = {};

    console.log(
      'Owner login reset. Remove RESET_ADMIN from environment variables.'
    );
  }

  await save();

  console.log(
    'MongoDB connected successfully. Database: ' + MONGODB_DB
  );
}