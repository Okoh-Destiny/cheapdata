const session = require("express-session");
const { db } = require("./db");

class SQLiteSessionStore extends session.Store {
    constructor(options = {}) {
        super();

        this.cleanupIntervalMs =
            options.cleanupIntervalMs || 15 * 60 * 1000;

        db.prepare(`
            CREATE TABLE IF NOT EXISTS sessions (
                sid TEXT PRIMARY KEY,
                sess TEXT NOT NULL,
                expire INTEGER NOT NULL
            )
        `).run();

        db.prepare(`
            CREATE INDEX IF NOT EXISTS idx_sessions_expire
            ON sessions(expire)
        `).run();

        this.cleanupTimer = setInterval(() => {
            this.cleanupExpired();
        }, this.cleanupIntervalMs);

        // Do not keep Node.js running just because of the cleanup timer.
        this.cleanupTimer.unref();
    }

    cleanupExpired() {
        try {
            db.prepare(`
                DELETE FROM sessions
                WHERE expire <= ?
            `).run(Date.now());
        } catch (error) {
            console.error("Session cleanup error:", error);
        }
    }

    get(sid, callback) {
        try {
            const row = db.prepare(`
                SELECT sess, expire
                FROM sessions
                WHERE sid = ?
            `).get(sid);

            if (!row) {
                return callback(null, null);
            }

            if (row.expire <= Date.now()) {
                db.prepare(`
                    DELETE FROM sessions
                    WHERE sid = ?
                `).run(sid);

                return callback(null, null);
            }

            const sessionData = JSON.parse(row.sess);

            return callback(null, sessionData);
        } catch (error) {
            return callback(error);
        }
    }

    set(sid, sessionData, callback) {
        try {
            const expire = this.getExpiry(sessionData);

            db.prepare(`
                INSERT INTO sessions (sid, sess, expire)
                VALUES (?, ?, ?)
                ON CONFLICT(sid)
                DO UPDATE SET
                    sess = excluded.sess,
                    expire = excluded.expire
            `).run(
                sid,
                JSON.stringify(sessionData),
                expire
            );

            return callback(null);
        } catch (error) {
            return callback(error);
        }
    }

    destroy(sid, callback) {
        try {
            db.prepare(`
                DELETE FROM sessions
                WHERE sid = ?
            `).run(sid);

            return callback(null);
        } catch (error) {
            return callback(error);
        }
    }

    touch(sid, sessionData, callback) {
        try {
            const expire = this.getExpiry(sessionData);

            db.prepare(`
                UPDATE sessions
                SET expire = ?
                WHERE sid = ?
            `).run(expire, sid);

            return callback(null);
        } catch (error) {
            return callback(error);
        }
    }

    clear(callback) {
        try {
            db.prepare(`
                DELETE FROM sessions
            `).run();

            return callback(null);
        } catch (error) {
            return callback(error);
        }
    }

    length(callback) {
        try {
            const result = db.prepare(`
                SELECT COUNT(*) AS count
                FROM sessions
            `).get();

            return callback(null, result.count);
        } catch (error) {
            return callback(error);
        }
    }

    all(callback) {
        try {
            const rows = db.prepare(`
                SELECT sid, sess, expire
                FROM sessions
            `).all();

            const sessions = {};

            for (const row of rows) {
                if (row.expire <= Date.now()) {
                    continue;
                }

                sessions[row.sid] = JSON.parse(row.sess);
            }

            return callback(null, sessions);
        } catch (error) {
            return callback(error);
        }
    }
    destroyUserSessions(userId, callback) {
    try {
        const rows = db.prepare(`
            SELECT sid, sess
            FROM sessions
        `).all();

        let deleted = 0;

        const deleteSession = db.prepare(`
            DELETE FROM sessions
            WHERE sid = ?
        `);

        const deleteMany = db.transaction((sessionIds) => {
            for (const sid of sessionIds) {
                deleteSession.run(sid);
            }
        });

        const sessionIds = [];

        for (const row of rows) {
            try {
                const sessionData = JSON.parse(row.sess);

                if (Number(sessionData.userId) === Number(userId)) {
                    sessionIds.push(row.sid);
                }
            } catch (error) {
                console.error(
                    `Could not read session ${row.sid} while invalidating user sessions:`,
                    error
                );
            }
        }

        if (sessionIds.length > 0) {
            deleteMany(sessionIds);
            deleted = sessionIds.length;
        }

        return callback(null, deleted);
    } catch (error) {
        return callback(error);
    }
}
    getExpiry(sessionData) {
        if (sessionData.cookie && sessionData.cookie.expires) {
            const expiry = new Date(
                sessionData.cookie.expires
            ).getTime();

            if (Number.isFinite(expiry)) {
                return expiry;
            }
        }

        return Date.now() + (1000 * 60 * 60 * 24);
    }
}

module.exports = SQLiteSessionStore;