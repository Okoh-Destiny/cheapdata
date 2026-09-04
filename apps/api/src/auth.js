function requireAuth(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({
            success: false,
            message: "Please log in to continue"
        });
    }
    next();
}

function getAdmin(db, userId) {
    return db.prepare(`
        SELECT
            id,
            name,
            email,
            is_admin
        FROM users
        WHERE id = ?
        AND is_admin = 1
    `).get(userId);
}

function requireAdmin(req, res, next) {
    const { db } = require("./db");
    const admin = getAdmin(db, req.session && req.session.userId);

    if (!admin) {
        return res.status(403).json({
            success: false,
            message: "Admin access required"
        });
    }

    req.admin = admin;
    next();
}

module.exports = {
    requireAuth,
    requireAdmin,
    getAdmin
};
