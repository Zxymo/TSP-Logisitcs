const mysql = require("mysql2/promise");
const ExcelJS = require("exceljs");

const allowedTruckPlates = new Set(["CCR 2867", "CCR 2869", "CBF 3034"]);
const truckCodeByLength = new Map([
    [40, "REG_40_45"],
    [45, "REG_40_45"],
    [50, "EXT_50"],
    [55, "EXT_55_60"],
    [60, "EXT_55_60"]
]);

function getPool() {
    if (globalThis.__tspTidbPool) {
        return globalThis.__tspTidbPool;
    }

    const config = {
        host: process.env.DB_HOST || process.env.TIDB_HOST,
        user: process.env.DB_USERNAME || process.env.TIDB_USER,
        password: process.env.DB_PASSWORD || process.env.TIDB_PASSWORD,
        database: process.env.DB_DATABASE || process.env.TIDB_DATABASE
    };
    const missingVariables = Object.entries(config)
        .filter((entry) => !entry[1])
        .map((entry) => entry[0]);
    if (missingVariables.length > 0) {
        throw new Error(`Missing database environment variables: ${missingVariables.join(", ")}`);
    }

    const ssl = { minVersion: "TLSv1.2", rejectUnauthorized: true };
    if (process.env.TIDB_CA_CERT) {
        ssl.ca = process.env.TIDB_CA_CERT.replace(/\\n/g, "\n");
    }

    globalThis.__tspTidbPool = mysql.createPool({
        host: config.host,
        port: Number(process.env.DB_PORT || process.env.TIDB_PORT || 4000),
        user: config.user,
        password: config.password,
        database: config.database,
        ssl,
        waitForConnections: true,
        connectionLimit: 5,
        queueLimit: 0,
        decimalNumbers: true
    });

    return globalThis.__tspTidbPool;
}

function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

function validText(value, maxLength) {
    return typeof value === "string" && value.trim().length > 0 && value.trim().length <= maxLength;
}

function parseBody(body) {
    if (typeof body === "string") {
        try {
            return JSON.parse(body);
        } catch {
            return null;
        }
    }
    return body && typeof body === "object" ? body : null;
}

async function getRoutes(pool) {
    const [routes] = await pool.query(`
        SELECT DISTINCT
            destination_id,
            destination_name,
            province_name,
            zone_id,
            truck_code,
            truck_type,
            card_name,
            rate_vat_inc,
            needs_review
        FROM vw_active_hauling_rates
        WHERE destination_id IS NOT NULL
          AND destination_name IS NOT NULL
          AND province_name IS NOT NULL
          AND zone_id IS NOT NULL
          AND truck_code IS NOT NULL
          AND truck_type IS NOT NULL
          AND card_name IS NOT NULL
          AND rate_vat_inc IS NOT NULL
        ORDER BY destination_name, truck_type, card_name
    `);
    return routes;
}

async function getDeliveries(pool) {
    const [deliveries] = await pool.query(`
        SELECT
            dr.id,
            DATE_FORMAT(dr.delivery_date, '%Y-%m-%d') AS delivery_date,
            dr.dr_number,
            dr.truck_plate,
            dr.customer_name,
            dr.destination_id,
            dr.zone_id,
            COALESCE(
                NULLIF(CONCAT_WS(', ', d.destination_name, p.province_name), ''),
                dr.destination
            ) AS destination,
            dr.post_length,
            dr.price_php,
            dr.archived_at
        FROM delivery_records AS dr
        LEFT JOIN destinations AS d ON d.destination_id = dr.destination_id
        LEFT JOIN provinces AS p ON p.province_id = d.province_id
        WHERE dr.archived_at IS NULL
        ORDER BY dr.created_at DESC, dr.id DESC
        LIMIT 100
    `);
    return deliveries;
}

async function exportDeliveries(pool, res) {
    const [deliveries] = await pool.query(`
        SELECT
            DATE_FORMAT(dr.delivery_date, '%Y-%m-%d') AS delivery_date,
            dr.dr_number,
            dr.customer_name,
            COALESCE(
                NULLIF(CONCAT_WS(', ', d.destination_name, p.province_name), ''),
                dr.destination
            ) AS destination,
            dr.price_php
        FROM delivery_records AS dr
        LEFT JOIN destinations AS d ON d.destination_id = dr.destination_id
        LEFT JOIN provinces AS p ON p.province_id = d.province_id
        ORDER BY dr.created_at DESC, dr.id DESC
    `);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "TSP Logistics";
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet("Delivery Logs");
    worksheet.columns = [
        { header: "DATE", key: "delivery_date", width: 16 },
        { header: "DR NO.", key: "dr_number", width: 22 },
        { header: "CUSTOMER'S NAME", key: "customer_name", width: 28 },
        { header: "DESTINATION", key: "destination", width: 32 },
        { header: "HAULING RATE", key: "price_php", width: 20 }
    ];
    worksheet.addRows(deliveries);
    worksheet.getRow(1).font = { bold: true };
    worksheet.getColumn(5).numFmt = '"₱"#,##0.00';
    worksheet.views = [{ state: "frozen", ySplit: 1 }];

    const file = await workbook.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="tsp-delivery-logs.xlsx"');
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(Buffer.from(file));
}

async function createDelivery(pool, body, res) {
    if (!body
        || !isValidDate(body.deliveryDate)
        || !validText(body.drNumber, 100)
        || !allowedTruckPlates.has(body.truckPlate)
        || !validText(body.customerName, 255)
        || !Number.isSafeInteger(Number(body.destinationId))
        || Number(body.destinationId) <= 0
        || !truckCodeByLength.has(Number(body.postLength))) {
        return res.status(400).json({ error: "Enter valid delivery details, a listed truck plate, and a supported truck length." });
    }

    const postLength = Number(body.postLength);
    const truckCode = truckCodeByLength.get(postLength);
    const [destinationRows] = await pool.query(`
        SELECT
            d.destination_id,
            d.destination_name,
            d.zone_id,
            z.zone_id AS matched_zone_id,
            p.province_name
        FROM destinations AS d
        LEFT JOIN hauling_zones AS z ON z.zone_id = d.zone_id
        LEFT JOIN provinces AS p ON p.province_id = d.province_id
        WHERE d.destination_id = ?
          AND d.is_active = 1
        LIMIT 1
    `, [Number(body.destinationId)]);

    if (destinationRows.length === 0) {
        return res.status(409).json({ error: "The selected delivery location is no longer active." });
    }

    const destinationRow = destinationRows[0];
    if (destinationRow.matched_zone_id === null || destinationRow.matched_zone_id === undefined) {
        return res.status(409).json({
            error: `Delivery location ${destinationRow.destination_name} references zone ${destinationRow.zone_id}, which is missing from hauling_zones. Correct its zone mapping in TiDB before saving.`
        });
    }
    if (!validText(destinationRow.province_name, 255)) {
        return res.status(409).json({
            error: `Delivery location ${destinationRow.destination_name} has no province assigned in TiDB.`
        });
    }

    const [rateRows] = await pool.query(`
        SELECT DISTINCT
            destination_id,
            rate_vat_inc
        FROM vw_active_hauling_rates
        WHERE destination_id = ?
          AND truck_code = ?
          AND rate_vat_inc IS NOT NULL
    `, [
        Number(body.destinationId),
        truckCode
    ]);

    if (rateRows.length === 0) {
        return res.status(409).json({ error: "No active rate is available for this location and truck length." });
    }
    const uniqueRates = new Set(rateRows.map((row) => Number(row.rate_vat_inc)));
    if (uniqueRates.size !== 1) {
        return res.status(409).json({ error: "Multiple active rates match this location and truck length. Ask an administrator to review the rates." });
    }

    const rate = rateRows[0];
    const destination = `${destinationRow.destination_name}, ${destinationRow.province_name}`;
    const zoneId = Number(destinationRow.zone_id);
    const [result] = await pool.execute(`
        INSERT INTO delivery_records (
            delivery_date,
            dr_number,
            truck_plate,
            customer_name,
            destination_id,
            zone_id,
            destination,
            post_length,
            price_php
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        body.deliveryDate,
        body.drNumber.trim(),
        body.truckPlate.trim(),
        body.customerName.trim(),
        Number(body.destinationId),
        zoneId,
        destination,
        postLength,
        Number(rate.rate_vat_inc)
    ]);

    return res.status(201).json({
        delivery: {
            id: result.insertId,
            delivery_date: body.deliveryDate,
            dr_number: body.drNumber.trim(),
            truck_plate: body.truckPlate.trim(),
            customer_name: body.customerName.trim(),
            destination_id: Number(body.destinationId),
            zone_id: zoneId,
            destination,
            post_length: postLength,
            price_php: Number(rate.rate_vat_inc)
        }
    });
}

module.exports = async function handler(req, res) {
    const origin = req.headers.origin;
    const allowedOrigins = (process.env.CORS_ORIGIN || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

    res.setHeader("Vary", "Origin");
    if (origin && allowedOrigins.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.setHeader("Access-Control-Max-Age", "86400");
    } else if (req.method === "OPTIONS" && origin) {
        return res.status(403).json({ error: "This website is not allowed to use the API." });
    } else if (origin && allowedOrigins.length > 0) {
        return res.status(403).json({ error: "This website is not allowed to use the API." });
    }

    if (req.method === "OPTIONS") {
        return res.status(204).end();
    }

    const action = req.query && req.query.action
        ? req.query.action
        : new URL(req.url, "http://localhost").searchParams.get("action");

    if (req.method === "GET" && !["health", "options", "deliveries", "dashboard", "export"].includes(action)) {
        return res.status(400).json({ error: "Choose an API action: health, options, deliveries, dashboard, or export." });
    }
    if (req.method === "POST" && action !== "deliveries") {
        res.setHeader("Allow", "GET, POST, DELETE");
        return res.status(405).json({ error: "POST requires the deliveries action." });
    }
    if (req.method === "DELETE" && action !== "deliveries") {
        res.setHeader("Allow", "GET, POST, DELETE");
        return res.status(405).json({ error: "DELETE requires the deliveries action." });
    }
    if (!["GET", "POST", "DELETE"].includes(req.method)) {
        res.setHeader("Allow", "GET, POST, DELETE");
        return res.status(405).json({ error: "Method not allowed." });
    }

    try {
        const pool = getPool();

        if (req.method === "POST") {
            return await createDelivery(pool, parseBody(req.body), res);
        }
        if (req.method === "DELETE") {
            const id = Number(req.query && req.query.id);
            if (!Number.isSafeInteger(id) || id <= 0) {
                return res.status(400).json({ error: "A valid delivery id is required." });
            }

            const [result] = await pool.execute(`
                UPDATE delivery_records
                SET archived_at = CURRENT_TIMESTAMP
                WHERE id = ? AND archived_at IS NULL
            `, [id]);
            if (result.affectedRows === 0) {
                return res.status(404).json({ error: "Active delivery not found." });
            }
            return res.status(200).json({ archived: true, id });
        }
        if (action === "health") {
            await pool.query("SELECT 1");
            return res.status(200).json({ status: "ok" });
        }
        if (action === "options") {
            return res.status(200).json({ routes: await getRoutes(pool) });
        }
        if (action === "deliveries") {
            return res.status(200).json({ deliveries: await getDeliveries(pool) });
        }
        if (action === "export") {
            return await exportDeliveries(pool, res);
        }

        await pool.query("SELECT 1");
        const [routes, deliveries] = await Promise.all([
            getRoutes(pool),
            getDeliveries(pool)
        ]);
        return res.status(200).json({ status: "ok", routes, deliveries });
    } catch (error) {
        console.error(`API action "${action}" failed:`, error.message);
        if (req.method === "POST" && error.code === "ER_NO_REFERENCED_ROW_2") {
            return res.status(409).json({
                error: "The active rate references a zone missing from hauling_zones. Correct the location's zone mapping in TiDB before saving."
            });
        }
        if (action === "health") {
            return res.status(503).json({ error: "TiDB is unavailable. Check the server configuration and database connection." });
        }
        if (req.method === "POST") {
            return res.status(500).json({ error: "Could not save the delivery. Check the database schema and connection." });
        }
        if (action === "options") {
            return res.status(500).json({ error: "Could not load active destination rates." });
        }
        if (action === "deliveries") {
            return res.status(500).json({ error: "Could not load saved deliveries." });
        }
        if (action === "export") {
            return res.status(500).json({ error: "Could not export delivery logs." });
        }
        return res.status(503).json({ error: "Could not load the dashboard from TiDB." });
    }
};
