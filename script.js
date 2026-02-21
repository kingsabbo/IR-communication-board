let fileHandle;
let patients = [];
let historyStack = [];
let redoStack = [];

// --- Utilities & UI ---
function updateClock() {
    const options = { timeZone: 'America/Los_Angeles', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    const clockEl = document.getElementById('pst-clock');
    if(clockEl) clockEl.innerText = new Date().toLocaleString('en-US', options) + " PST";
}
setInterval(updateClock, 1000);
updateClock();

function showInstructions() {
    alert("Welcome to the IR Communication Board!");
}

function showStatusMessage(msg, isWarning = false) {
    const statusEl = document.getElementById('save-status');
    statusEl.innerText = msg;
    if (isWarning) {
        statusEl.classList.add('warning');
        setTimeout(() => statusEl.classList.remove('warning'), 3000);
    }
}

function formatTimeDisplay(ms) {
    if (!ms || ms <= 0) return "0 sec";
    const totalSeconds = Math.floor(ms / 1000);
    return totalSeconds < 60 ? `${totalSeconds} sec` : `${Math.round(totalSeconds / 60)} min`;
}

function autoExpand(el) {
    el.style.height = 'inherit';
    el.style.height = (el.scrollHeight) + 'px';
}

// --- File Handling (Audit Log Append Mode) ---
async function createNewDay() {
    const date = new Date();
    const fileName = `IR_Board_${date.getDate()}_${date.getMonth() + 1}_${date.getFullYear()}.csv`;
    try {
        fileHandle = await window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: 'CSV File', accept: { 'text/csv': ['.csv'] } }] });
        document.getElementById('board-filename').innerText = `Current board: ${fileHandle.name}`;
        document.getElementById('setup-overlay').style.display = 'none';
        saveToFile();
    } catch (err) { console.log("Picker cancelled"); }
}

async function loadExistingDay() {
    try {
        [fileHandle] = await window.showOpenFilePicker({ types: [{ description: 'CSV File', accept: { 'text/csv': ['.csv'] } }] });
        const file = await fileHandle.getFile();
        const content = await file.text();
        try {
            parseCSV(content);
            document.getElementById('board-filename').innerText = `Current board: ${fileHandle.name}`;
            document.getElementById('setup-overlay').style.display = 'none';
            render();
        } catch (e) { alert(`This file is not compatible. \n\nError: ${e.message}`); }
    } catch (err) { console.log("Picker cancelled"); }
}

async function saveToFile(patientObj = null) {
    if (!fileHandle) return;
    const now = new Date();
    const timeStr = now.getHours() + ":" + now.getMinutes().toString().padStart(2, '0');
    const timestamp = Date.now();

    const headers = "initials,bed,procedure,checkedIn,consented,iv,status,notes,sedate,scrub,report,porter,stats_checkIn,stats_preOp,stats_proc,stats_postOp,guid,timestamps_added,lastTransitionTime,lastSavedTime,lastSavedMs\n";
    
    try {
        const file = await fileHandle.getFile();
        let currentContent = await file.text();
        if (currentContent.length === 0) currentContent = headers;

        if (patientObj) {
            patientObj.lastSavedTime = timeStr;
            patientObj.lastSavedMs = timestamp;
            const row = [
                patientObj.initials, patientObj.bed, patientObj.procedure, patientObj.checkedIn, patientObj.consented, patientObj.iv, patientObj.status, 
                `"${patientObj.notes.replace(/"/g, '""')}"`, `"${patientObj.sedate}"`, `"${patientObj.scrub}"`, 
                patientObj.report, patientObj.porter, patientObj.stats.checkIn, patientObj.stats.preOp, 
                patientObj.stats.proc, patientObj.stats.postOp, patientObj.guid, 
                patientObj.timestamps.added, patientObj.lastTransitionTime, patientObj.lastSavedTime, patientObj.lastSavedMs
            ].join(",") + "\n";
            currentContent += row;
        }

        const writable = await fileHandle.createWritable();
        await writable.write(currentContent);
        await writable.close();
        showStatusMessage("Last Saved: " + timeStr);
    } catch (e) { showStatusMessage("Save Error", true); }
}

function parseCSV(text) {
    const lines = text.split("\n");
    if (!lines[0].includes("guid")) throw new Error("Invalid format.");
    const allHistory = lines.slice(1).filter(l => l.trim() !== "").map(line => {
        const parts = line.split(",");
        return {
            initials: parts[0], bed: parts[1], procedure: parts[2], checkedIn: parts[3], consented: parts[4], iv: parts[5], status: parts[6], 
            notes: parts[7].replace(/"/g, ''), sedate: parts[8].replace(/"/g, ''), scrub: parts[9].replace(/"/g, ''), report: parts[10], porter: parts[11],
            stats: { checkIn: Number(parts[12]), preOp: Number(parts[13]), proc: Number(parts[14]), postOp: Number(parts[15]) },
            guid: parts[16], timestamps: { added: Number(parts[17]) }, lastTransitionTime: Number(parts[18]), lastSavedTime: parts[19], lastSavedMs: Number(parts[20])
        };
    });
    const latestMap = new Map();
    allHistory.forEach(entry => {
        const existing = latestMap.get(entry.guid);
        if (!existing || entry.lastSavedMs > existing.lastSavedMs) latestMap.set(entry.guid, entry);
    });
    patients = Array.from(latestMap.values());
}

// --- App Functions ---
function addPerson() {
    const input = document.getElementById('newInitials');
    const initials = input.value.toUpperCase().trim();
    if (!initials) return;
    const newP = {
        guid: crypto.randomUUID(), initials, bed: '', procedure: '', checkedIn: 'NEEDED', consented: 'NEEDED', iv: 'NEEDED', status: 'new', notes: '', 
        sedate: 'N/A', scrub: 'N/A', report: 'NEEDED', porter: 'NEEDED',
        timestamps: { added: Date.now() }, lastTransitionTime: Date.now(),
        stats: { checkIn: 0, preOp: 0, proc: 0, postOp: 0 }, lastSavedTime: '', lastSavedMs: Date.now()
    };
    patients.push(newP);
    input.value = '';
    render();
    saveToFile(newP);
}

function updateField(guid, field, value) {
    const p = patients.find(p => p.guid === guid);
    if (!p || p[field] === value) return;
    historyStack.push(JSON.parse(JSON.stringify(p)));
    if (historyStack.length > 30) historyStack.shift();
    redoStack = [];
    const oldStatus = p.status;
    if (field === 'status' && oldStatus !== value) calculateStats(p, oldStatus, value);
    p[field] = value;
    render();
    saveToFile(p);
}

function calculateStats(p, oldS, newS) {
    const now = Date.now();
    const diff = now - p.lastTransitionTime;
    if (newS === 'checked-in') p.stats.checkIn = now - p.timestamps.added;
    if ((oldS === 'checked-in' || oldS === 'ready for procedure') && newS.includes('intra')) p.stats.preOp = diff;
    if (oldS.includes('intra') && newS === 'post-op') p.stats.proc = diff;
    if (oldS === 'post-op' && newS === 'discharged') p.stats.postOp = diff;
    p.lastTransitionTime = now;
}

function undoLastAction() {
    if (historyStack.length === 0) return showStatusMessage("no changes to undo", true);
    const prev = historyStack.pop();
    const current = patients.find(p => p.guid === prev.guid);
    redoStack.push(JSON.parse(JSON.stringify(current)));
    const idx = patients.findIndex(p => p.guid === prev.guid);
    patients[idx] = prev;
    render();
    saveToFile(patients[idx]);
    showStatusMessage("Undo successful");
}

function redoLastAction() {
    if (redoStack.length === 0) return showStatusMessage("there are no changes to redo", true);
    const next = redoStack.pop();
    const current = patients.find(p => p.guid === next.guid);
    historyStack.push(JSON.parse(JSON.stringify(current)));
    const idx = patients.findIndex(p => p.guid === next.guid);
    patients[idx] = next;
    render();
    saveToFile(patients[idx]);
    showStatusMessage("Redo successful");
}

function deletePerson(guid) {
    if (confirm("Remove this row?")) { patients = patients.filter(p => p.guid !== guid); render(); }
}

function confirmReset() {
    if (confirm("Reset Board? All unsaved visual changes will be lost.")) { patients = []; document.getElementById('board-filename').innerText = "Current board: no file loaded"; render(); }
}

function render() {
    const activeBody = document.getElementById('activeBody');
    const discBody = document.getElementById('dischargedBody');
    const search = document.getElementById('searchInput').value.toLowerCase();
    activeBody.innerHTML = ''; discBody.innerHTML = '';
    
    let activeTotal = 0, dischargedTotal = 0;
    const initCounts = patients.reduce((acc, p) => { acc[p.initials] = (acc[p.initials] || 0) + 1; return acc; }, {});

    patients.forEach(p => {
        if (![p.initials, p.procedure, p.notes].some(f => f.toLowerCase().includes(search))) return;
        const checkNeeded = (v) => v === 'NEEDED' ? 'needed-highlight' : '';
        let sCls = 'status-' + p.status.split(' ')[0].replace('(', '').replace(')', '');
        if (p.status === 'ready for procedure') sCls = 'status-ready';
        if (p.status.includes('intra')) sCls = 'status-intra';

        const row = `
            <tr class="${sCls}">
                <td class="${initCounts[p.initials] > 1 ? 'duplicate-warning' : ''}">${p.initials}</td>
                <td><select onchange="updateField('${p.guid}', 'bed', this.value)">
                    ${['',8,9,10,11,12,13,14,15,16].map(b => `<option value="${b}" ${p.bed == b ? 'selected' : ''}>${b}</option>`).join('')}
                </select></td>
                <td><textarea class="auto-grow" maxlength="100" oninput="autoExpand(this)" onblur="updateField('${p.guid}', 'procedure', this.value)">${p.procedure}</textarea></td>
                <td><select class="${checkNeeded(p.checkedIn)}" onchange="updateField('${p.guid}', 'checkedIn', this.value)">
                    ${['NEEDED', 'Yes (full)', 'Yes (continuity of care)', 'Not needed'].map(v => `<option ${p.checkedIn === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select></td>
                <td><select class="${checkNeeded(p.consented)}" onchange="updateField('${p.guid}', 'consented', this.value)">
                    ${['NEEDED', 'Done', 'Not Needed'].map(v => `<option ${p.consented === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select></td>
                <td><select class="${checkNeeded(p.iv)}" onchange="updateField('${p.guid}', 'iv', this.value)">
                    ${['NEEDED', 'In Situ', 'PICC', 'Port', 'Not Needed'].map(v => `<option ${p.iv === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select></td>
                <td><select onchange="updateField('${p.guid}', 'status', this.value)">
                    ${['new', 'arrived', 'checked-in', 'ready for procedure', 'intra (IR-A)', 'intra (IR-B)', 'post-op', 'discharged'].map(v => `<option ${p.status === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select></td>
                <td><textarea class="auto-grow" maxlength="500" oninput="autoExpand(this)" onblur="updateField('${p.guid}', 'notes', this.value)">${p.notes}</textarea></td>
                <td><input type="text" list="sedateList" value="${p.sedate}" onblur="updateField('${p.guid}', 'sedate', this.value)">
                    <datalist id="sedateList"><option value="N/A"></datalist></td>
                <td><input type="text" list="scrubList" value="${p.scrub}" onblur="updateField('${p.guid}', 'scrub', this.value)">
                    <datalist id="scrubList"><option value="N/A"></datalist></td>
                <td><select class="${checkNeeded(p.report)}" onchange="updateField('${p.guid}', 'report', this.value)">
                    ${['NEEDED', 'Report Given', 'Not Needed'].map(v => `<option ${p.report === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select></td>
                <td><select class="${checkNeeded(p.porter)}" onchange="updateField('${p.guid}', 'porter', this.value)">
                    ${['NEEDED', 'Booked', 'Not Needed'].map(v => `<option ${p.porter === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select></td>
                <td>In:${formatTimeDisplay(p.stats.checkIn)} | Pre:${formatTimeDisplay(p.stats.preOp)} | Pro:${formatTimeDisplay(p.stats.proc)} | Po:${formatTimeDisplay(p.stats.postOp)}</td>
                <td class="no-print"><button class="delete-btn" onclick="deletePerson('${p.guid}')">×</button></td>
                <td class="last-saved-cell">${p.lastSavedTime}</td>
            </tr>`;
        
        if (p.status === 'discharged') { discBody.innerHTML += row; dischargedTotal++; }
        else { activeBody.innerHTML += row; activeTotal++; }
    });
    document.getElementById('active-count').innerText = activeTotal;
    document.getElementById('discharged-count').innerText = dischargedTotal;
    document.querySelectorAll('textarea.auto-grow').forEach(el => autoExpand(el));
}

// Shortcuts
window.addEventListener('keydown', (e) => {
    const isTyping = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { if (!isTyping) { e.preventDefault(); undoLastAction(); } }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { if (!isTyping) { e.preventDefault(); redoLastAction(); } }
});

window.onbeforeprint = () => {
    document.getElementById('print-timestamp').innerText = new Date().toLocaleString('en-US') + " PST";
};
