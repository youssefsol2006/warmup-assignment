const fs = require('fs');

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Converts a 12-hour time string ("h:mm:ss am/pm") to total seconds.
 */
function parseTimeToSeconds(timeStr) {
    timeStr = timeStr.trim();
    const parts = timeStr.split(' ');
    const timePart = parts[0];
    const period = parts.length > 1 ? parts[1].toLowerCase() : null;

    const [h, m, s] = timePart.split(':').map(Number);

    let hours = h;
    if (period === 'am') {
        if (hours === 12) hours = 0;          // 12:xx am → 0:xx (midnight)
    } else if (period === 'pm') {
        if (hours !== 12) hours += 12;        // 1–11 pm → 13–23
    }

    return hours * 3600 + m * 60 + s;
}

/**
 * Converts an "h:mm:ss" string to total seconds.
 */
function hmsToSeconds(hms) {
    const [h, m, s] = hms.trim().split(':').map(Number);
    return h * 3600 + m * 60 + s;
}

/**
 * Converts total seconds to "h:mm:ss" (hours are NOT zero-padded).
 */
function secondsToHMS(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.round(totalSeconds % 60);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Reads the shifts file and returns an array of non-empty trimmed lines.
 */
function readLines(filePath) {
    try {
        return fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim() !== '');
    } catch (e) {
        return [];
    }
}

// ─── Function 1 ───────────────────────────────────────────────────────────────

/**
 * Calculates the difference between endTime and startTime.
 * @param {string} startTime - "hh:mm:ss am" or "hh:mm:ss pm"
 * @param {string} endTime   - "hh:mm:ss am" or "hh:mm:ss pm"
 * @returns {string} duration formatted as "h:mm:ss"
 */
function getShiftDuration(startTime, endTime) {
    const diff = parseTimeToSeconds(endTime) - parseTimeToSeconds(startTime);
    return secondsToHMS(diff);
}

// ─── Function 2 ───────────────────────────────────────────────────────────────

/**
 * Calculates idle time (time outside the 8:00 AM – 10:00 PM delivery window).
 * @param {string} startTime - "hh:mm:ss am" or "hh:mm:ss pm"
 * @param {string} endTime   - "hh:mm:ss am" or "hh:mm:ss pm"
 * @returns {string} idle time formatted as "h:mm:ss"
 */
function getIdleTime(startTime, endTime) {
    const startSec = parseTimeToSeconds(startTime);
    const endSec   = parseTimeToSeconds(endTime);

    const deliveryStart = 8  * 3600;   // 08:00:00
    const deliveryEnd   = 22 * 3600;   // 22:00:00  (10 PM)

    let idleSec = 0;

    // Idle time BEFORE delivery hours begin
    if (startSec < deliveryStart) {
        idleSec += Math.min(deliveryStart, endSec) - startSec;
    }

    // Idle time AFTER delivery hours end
    if (endSec > deliveryEnd) {
        idleSec += endSec - Math.max(deliveryEnd, startSec);
    }

    return secondsToHMS(Math.max(0, idleSec));
}

// ─── Function 3 ───────────────────────────────────────────────────────────────

/**
 * Calculates active delivery time = shiftDuration − idleTime.
 * @param {string} shiftDuration - "h:mm:ss"
 * @param {string} idleTime      - "h:mm:ss"
 * @returns {string} active time formatted as "h:mm:ss"
 */
function getActiveTime(shiftDuration, idleTime) {
    return secondsToHMS(hmsToSeconds(shiftDuration) - hmsToSeconds(idleTime));
}

// ─── Function 4 ───────────────────────────────────────────────────────────────

/**
 * Returns true if activeTime meets the daily quota.
 * Normal quota = 8h 24m; Eid quota (Apr 10–30, 2025) = 6h.
 * @param {string} date       - "yyyy-mm-dd"
 * @param {string} activeTime - "h:mm:ss"
 * @returns {boolean}
 */
function metQuota(date, activeTime) {
    const activeSec = hmsToSeconds(activeTime);

    // Parse date parts manually to avoid timezone shifting
    const [year, month, day] = date.split('-').map(Number);

    const isEid = (year === 2025 && month === 4 && day >= 10 && day <= 30);
    const quotaSec = isEid ? 6 * 3600 : (8 * 3600 + 24 * 60);

    return activeSec >= quotaSec;
}

// ─── Function 5 ───────────────────────────────────────────────────────────────

/**
 * Adds a new shift record to the text file.
 * Returns the new record object (10 properties) or {} if duplicate.
 * @param {string} textFile - path to shifts.txt
 * @param {object} shiftObj - { driverID, driverName, date, startTime, endTime }
 * @returns {object}
 */
function addShiftRecord(textFile, shiftObj) {
    const { driverID, driverName, date, startTime, endTime } = shiftObj;

    const lines = readLines(textFile);

    // 1. Check for duplicate (same driverID + date)
    for (const line of lines) {
        const cols = line.split(',');
        if (cols[0].trim() === driverID && cols[2].trim() === date) {
            return {};
        }
    }

    // 2. Calculate derived fields
    const shiftDuration = getShiftDuration(startTime, endTime);
    const idleTime      = getIdleTime(startTime, endTime);
    const activeTime    = getActiveTime(shiftDuration, idleTime);
    const quota         = metQuota(date, activeTime);
    const hasBonus      = false;

    const newObj = {
        driverID,
        driverName,
        date,
        startTime,
        endTime,
        shiftDuration,
        idleTime,
        activeTime,
        metQuota: quota,
        hasBonus
    };

    const newLine = [
        driverID, driverName, date,
        startTime, endTime,
        shiftDuration, idleTime, activeTime,
        quota, hasBonus
    ].join(',');

    // 3. Find insertion point: after the last record of this driverID
    let lastIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].split(',')[0].trim() === driverID) {
            lastIndex = i;
        }
    }

    if (lastIndex === -1) {
        lines.push(newLine);        // driverID not found → append at end
    } else {
        lines.splice(lastIndex + 1, 0, newLine);  // insert after last occurrence
    }

    fs.writeFileSync(textFile, lines.join('\n') + '\n');
    return newObj;
}

// ─── Function 6 ───────────────────────────────────────────────────────────────

/**
 * Sets the hasBonus field for a specific driverID + date in the file.
 * @param {string}  textFile - path to shifts.txt
 * @param {string}  driverID
 * @param {string}  date     - "yyyy-mm-dd"
 * @param {boolean} newValue
 */
function setBonus(textFile, driverID, date, newValue) {
    const rawContent = fs.readFileSync(textFile, 'utf8');
    const lines = rawContent.split('\n');

    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const cols = lines[i].split(',');
        if (cols[0].trim() === driverID && cols[2].trim() === date) {
            cols[9] = String(newValue);
            lines[i] = cols.join(',');
            break;
        }
    }

    fs.writeFileSync(textFile, lines.join('\n'));
}

// ─── Function 7 ───────────────────────────────────────────────────────────────

/**
 * Counts records where hasBonus === true for a given driverID and month.
 * Returns -1 if driverID does not exist in the file.
 * @param {string} textFile - path to shifts.txt
 * @param {string} driverID
 * @param {string} month    - "m" or "mm"  (e.g. "4" or "04")
 * @returns {number}
 */
function countBonusPerMonth(textFile, driverID, month) {
    const lines = readLines(textFile);
    const targetMonth = parseInt(month, 10);

    let found = false;
    let count = 0;

    for (const line of lines) {
        const cols = line.split(',');
        if (cols[0].trim() === driverID) {
            found = true;
            const m = parseInt(cols[2].trim().split('-')[1], 10);
            if (m === targetMonth && cols[9].trim() === 'true') {
                count++;
            }
        }
    }

    return found ? count : -1;
}

// ─── Function 8 ───────────────────────────────────────────────────────────────

/**
 * Sums all activeTime values for a given driverID and month (day-off days included).
 * @param {string} textFile - path to shifts.txt
 * @param {string} driverID
 * @param {number} month    - numeric month (e.g. 4)
 * @returns {string} total active hours as "hhh:mm:ss"
 */
function getTotalActiveHoursPerMonth(textFile, driverID, month) {
    const lines = readLines(textFile);
    let totalSec = 0;

    for (const line of lines) {
        const cols = line.split(',');
        if (cols[0].trim() !== driverID) continue;

        const m = parseInt(cols[2].trim().split('-')[1], 10);
        if (m === month) {
            totalSec += hmsToSeconds(cols[7].trim());
        }
    }

    const h   = Math.floor(totalSec / 3600);
    const min = Math.floor((totalSec % 3600) / 60);
    const sec = totalSec % 60;
    return `${h}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ─── Function 9 ───────────────────────────────────────────────────────────────

/**
 * Calculates total required hours for a driver in a given month.
 * - Excludes days that fall on the driver's day off.
 * - Uses Eid quota (6h) for Apr 10–30, 2025; otherwise 8h 24m.
 * - Subtracts 2h for each bonus earned that month.
 * @param {string} textFile   - path to shifts.txt
 * @param {string} rateFile   - path to driverRates.txt
 * @param {number} bonusCount - total bonuses for the driver in the month
 * @param {string} driverID
 * @param {number} month      - numeric month (e.g. 4)
 * @returns {string} required hours as "hhh:mm:ss"
 */
function getRequiredHoursPerMonth(textFile, rateFile, bonusCount, driverID, month) {
    const shiftLines = readLines(textFile);
    const rateLines  = readLines(rateFile);

    // Look up the driver's day off from driverRates.txt
    let dayOff = null;
    for (const line of rateLines) {
        const cols = line.split(',');
        if (cols[0].trim() === driverID) {
            dayOff = cols[1].trim();   // e.g. "Saturday"
            break;
        }
    }

    const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    let totalSec = 0;

    for (const line of shiftLines) {
        const cols = line.split(',');
        if (cols[0].trim() !== driverID) continue;

        const dateStr = cols[2].trim();
        const [year, mon, day] = dateStr.split('-').map(Number);
        if (mon !== month) continue;

        // Skip if this date falls on the driver's day off
        const dateObj = new Date(year, mon - 1, day);   // local time – no timezone shift
        if (DAY_NAMES[dateObj.getDay()] === dayOff) continue;

        // Determine quota for this specific day
        const isEid = (year === 2025 && mon === 4 && day >= 10 && day <= 30);
        totalSec += isEid ? 6 * 3600 : (8 * 3600 + 24 * 60);
    }

    // Each bonus reduces required hours by 2
    totalSec -= bonusCount * 2 * 3600;
    if (totalSec < 0) totalSec = 0;

    const h   = Math.floor(totalSec / 3600);
    const min = Math.floor((totalSec % 3600) / 60);
    const sec = totalSec % 60;
    return `${h}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// ─── Function 10 ──────────────────────────────────────────────────────────────

/**
 * Calculates the driver's net monthly pay after deductions for missing hours.
 *
 * Tier allowances (no deduction):
 *   1 (Senior) → 50 h
 *   2 (Regular) → 20 h
 *   3 (Junior)  → 10 h
 *   4 (Trainee) →  3 h
 *
 * deductionRatePerHour = ⌊basePay / 185⌋
 * salaryDeduction      = billableFullHours × deductionRatePerHour
 * netPay               = basePay − salaryDeduction
 *
 * @param {string} driverID
 * @param {string} actualHours   - "hhh:mm:ss"
 * @param {string} requiredHours - "hhh:mm:ss"
 * @param {string} rateFile      - path to driverRates.txt
 * @returns {number} net pay as an integer
 */
function getNetPay(driverID, actualHours, requiredHours, rateFile) {
    const rateLines = readLines(rateFile);

    let basePay = 0;
    let tier    = 0;

    for (const line of rateLines) {
        const cols = line.split(',');
        if (cols[0].trim() === driverID) {
            basePay = parseInt(cols[2].trim(), 10);
            tier    = parseInt(cols[3].trim(), 10);
            break;
        }
    }

    const actualSec   = hmsToSeconds(actualHours);
    const requiredSec = hmsToSeconds(requiredHours);

    // No deduction if driver met or exceeded required hours
    if (actualSec >= requiredSec) return basePay;

    const ALLOWANCES = { 1: 50, 2: 20, 3: 10, 4: 3 };
    const allowedMissingHours = ALLOWANCES[tier] || 0;

    // Total missing in hours (decimal)
    const totalMissingHours = (requiredSec - actualSec) / 3600;

    // Subtract the tier allowance; only full hours are billed
    const billableHours = totalMissingHours - allowedMissingHours;
    if (billableHours <= 0) return basePay;

    const fullBillableHours   = Math.floor(billableHours);
    const deductionRatePerHour = Math.floor(basePay / 185);
    const salaryDeduction      = fullBillableHours * deductionRatePerHour;

    return basePay - salaryDeduction;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    getShiftDuration,
    getIdleTime,
    getActiveTime,
    metQuota,
    addShiftRecord,
    setBonus,
    countBonusPerMonth,
    getTotalActiveHoursPerMonth,
    getRequiredHoursPerMonth,
    getNetPay
};
