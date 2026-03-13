const fs = require('fs');

// --- Helper Functions (Humanized Logic) ---

/**
 * Converts a time string like "6:01:20 am" or "146:20:00" into total seconds.
 */
function timeStringToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.toLowerCase().split(' ');
    const timeParts = parts[0].split(':').map(Number);
    let hours = timeParts[0];
    let minutes = timeParts[1];
    let seconds = timeParts[2];

    if (parts[1] === 'pm' && hours !== 12) hours += 12;
    if (parts[1] === 'am' && hours === 12) hours = 0;

    return (hours * 3600) + (minutes * 60) + seconds;
}

/**
 * Converts total seconds back to a string format "h:mm:ss".
 */
function secondsToTimeString(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// --- Assignment Functions ---

// Function 1: getShiftDuration [cite: 380]
function getShiftDuration(startTime, endTime) {
    const duration = timeStringToSeconds(endTime) - timeStringToSeconds(startTime);
    return secondsToTimeString(duration);
}

// Function 2: getIdleTime (Delivery hours: 8 AM - 10 PM) [cite: 398, 401]
function getIdleTime(startTime, endTime) {
    const start = timeStringToSeconds(startTime);
    const end = timeStringToSeconds(endTime);
    const deliveryStart = 8 * 3600; // 8:00 AM
    const deliveryEnd = 22 * 3600;  // 10:00 PM

    let idle = 0;
    if (start < deliveryStart) idle += (deliveryStart - start);
    if (end > deliveryEnd) idle += (end - deliveryEnd);
    
    return secondsToTimeString(idle);
}

// Function 3: getActiveTime [cite: 416]
function getActiveTime(shiftDuration, idleTime) {
    const active = timeStringToSeconds(shiftDuration) - timeStringToSeconds(idleTime);
    return secondsToTimeString(active);
}

// Function 4: metQuota (Eid period: April 10-30, 2025) [cite: 432, 439]
function metQuota(date, activeTime) {
    const activeSec = timeStringToSeconds(activeTime);
    const dateObj = new Date(date);
    const isEid = dateObj >= new Date("2025-04-10") && dateObj <= new Date("2025-04-30");
    
    const required = isEid ? (6 * 3600) : (8 * 3600 + 24 * 60); // 6h vs 8h 24m [cite: 437, 438]
    return activeSec >= required;
}

// Function 5: addShiftRecord [cite: 460]
function addShiftRecord(textFile, shiftObj) {
    const data = fs.readFileSync(textFile, 'utf8').split('\n').filter(line => line.trim() !== "");
    const exists = data.some(line => line.includes(shiftObj.driverID) && line.includes(shiftObj.date));
    if (exists) return {};

    const duration = getShiftDuration(shiftObj.startTime, shiftObj.endTime);
    const idle = getIdleTime(shiftObj.startTime, shiftObj.endTime);
    const active = getActiveTime(duration, idle);
    const met = metQuota(shiftObj.date, active);

    const newRow = `${shiftObj.driverID},${shiftObj.driverName},${shiftObj.date},${shiftObj.startTime},${shiftObj.endTime},${duration},${idle},${active},${met},false`;

    // Find insertion index [cite: 468]
    let lastIndex = -1;
    for (let i = 0; i < data.length; i++) {
        if (data[i].startsWith(shiftObj.driverID)) lastIndex = i;
    }

    if (lastIndex === -1) data.push(newRow);
    else data.splice(lastIndex + 1, 0, newRow);

    fs.writeFileSync(textFile, data.join('\n'));
    return { ...shiftObj, shiftDuration: duration, idleTime: idle, activeTime: active, metQuota: met, hasBonus: false };
}

// Function 10: getNetPay [cite: 606]
function getNetPay(driverID, actualHours, requiredHours, rateFile) {
    const rates = fs.readFileSync(rateFile, 'utf8').split('\n');
    const driverLine = rates.find(line => line.startsWith(driverID));
    if (!driverLine) return 0;

    const [id, dayOff, basePayStr, tierStr] = driverLine.split(',');
    const basePay = parseInt(basePayStr);
    const tier = parseInt(tierStr);

    const actual = timeStringToSeconds(actualHours);
    const required = timeStringToSeconds(requiredHours);

    if (actual >= required) return basePay; // [cite: 612]

    const missingSec = required - actual;
    const missingHrsTotal = missingSec / 3600;
    
    // Allowance mapping [cite: 610]
    const allowanceMap = { 1: 50, 2: 20, 3: 10, 4: 3 };
    const billableHrs = Math.floor(Math.max(0, missingHrsTotal - allowanceMap[tier])); // [cite: 623, 629]
    
    const deductionRate = Math.floor(basePay / 185); // [cite: 613]
    return basePay - (billableHrs * deductionRate);
}

// Export functions if using commonjs for tests
module.exports = { 
    getShiftDuration, getIdleTime, getActiveTime, metQuota, 
    addShiftRecord, getNetPay 
};