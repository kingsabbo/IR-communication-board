let fileHandle;
let patients = [];
let historyStack = [];
let lastSaveTimestamp = 0;

function updateClock() {
    const options = { timeZone: 'America/Los_Angeles', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    const el = document.getElementById('pst-clock');
    if (el) el.innerText = new Date().toLocaleString('en-US', options) + " PST";
}
setInterval(updateClock, 1000);
updateClock();

// --- Autosave Logic (Every 5 Minutes) ---
setInterval(() => {
    const fiveMinutes = 5 * 60 * 1000;
    if (fileHandle && (Date.now() - lastSaveTimestamp) >= fiveMinutes) {
        manualSave();
    }
}, 60000); 

function clearSearch() { document.getElementById('searchInput').value = ''; render(); }

function showStatusMessage(msg) {
    document.getElementById('save-status').innerText = msg;
}

function formatTimeDisplay(ms) {
    if (!ms || ms <= 0) return "0m 0s";
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}m ${secs}s`;
}

function autoExpand(el) { el.style.height = 'inherit'; el.style.height = (el.scrollHeight) + 'px'; }

async function createNewDay() {
    try {
        fileHandle = await window.showSaveFilePicker({ suggestedName: `IR_Board_${new Date().toLocaleDateString().replace(/\//g,'_')}.csv` });
        document.getElementById('board-filename').innerText = `Current Board: ${fileHandle.name}`;
        document.getElementById('setup-overlay').style.display = 'none';
        await writeFullFile();
    } catch (err) { console.error(err); }
}

async function loadExistingDay() {
    try {
        const [handle] = await window.showOpenFilePicker();
        fileHandle = handle;
        const file = await fileHandle.getFile();
        const text = await file.text();
        parseCSV(text);
        document.getElementById('board-filename').innerText = `Current Board: ${fileHandle.name}`;
        document.getElementById('setup-overlay').style.display = 'none';
        render();
    } catch (err) { console.error(err); }
}

async function manualSave() {
    if (!fileHandle) return;
    await writeFullFile();
    render(); 
    showStatusMessage("Board Refreshed & Saved");
}

async function writeFullFile() {
    if (!fileHandle) return;
    const header = "initials,bed,procedure,checkedIn,consented,iv,status,notes,sedate,scrub,report,porter,stats_checkIn,stats_preOp,stats_proc,stats_postOp,stats_total,guid,logs,lastSavedTime,lastSavedMs,added_ts\n";
    let content = header;
    
    patients.forEach(p => {
        content += [
            p.initials, p.bed, p.procedure, p.checkedIn, p.consented, p.iv, p.status,
            `"${p.notes.replace(/"/g, '""')}"`, `"${p.sedate}"`, `"${p.scrub}"`, p.report, p.porter,
            p.stats.checkIn, p.stats.preOp, p.stats.proc, p.stats.postOp, p.stats.total,
            p.guid, `"${JSON.stringify(p.logs).replace(/"/g, '""')}"`, p.lastSavedTime, p.lastSavedMs, p.timestamps.added
        ].join(",") + "\n";
    });

    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    lastSaveTimestamp = Date.now();
    showStatusMessage("Last Saved: " + new Date().toLocaleTimeString());
}

function parseCSV(text) {
    const lines = text.split("\n");
    if (lines.length <= 1) return;
    const latestEntries = new Map();
    lines.slice(1).filter(l => l.trim() !== "").forEach(line => {
        const p = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        const entry = {
            initials: p[0], bed: p[1], procedure: p[2], checkedIn: p[3], consented: p[4], iv: p[5], status: p[6],
            notes: (p[7] || "").replace(/"/g, ''), sedate: (p[8] || "").replace(/"/g, ''), scrub: (p[9] || "").replace(/"/g, ''), report: p[10], porter: p[11],
            stats: { checkIn: Number(p[12]), preOp: Number(p[13]), proc: Number(p[14]), postOp: Number(p[15]), total: Number(p[16]) },
            guid: p[17], logs: JSON.parse(p[18].replace(/""/g, '"').replace(/^"|"$/g, '')), lastSavedTime: p[19], lastSavedMs: Number(p[20]),
            timestamps: { added: Number(p[21] || Date.now()) }
        };
        if (!latestEntries.has(entry.guid) || entry.lastSavedMs > latestEntries.get(entry.guid).lastSavedMs) {
            latestEntries.set(entry.guid, entry);
        }
    });
    patients = Array.from(latestEntries.values());
}

function addPerson() {
    const input = document.getElementById('newInitials');
    const initials = input.value.toUpperCase().trim();
    if (!initials) return;
    const now = Date.now();
    const newP = {
        guid: crypto.randomUUID(), initials, bed: '', procedure: '', checkedIn: 'NEEDED', consented: 'NEEDED', iv: 'NEEDED', status: 'newly arrived', notes: '', 
        sedate: 'N/A', scrub: 'N/A', report: 'NEEDED POST-OP', porter: 'NEEDED POST-OP',
        timestamps: { added: now }, logs: { 'newly arrived_first': now, 'newly arrived_latest': now },
        stats: { checkIn: 0, preOp: 0, proc: 0, postOp: 0, total: 0 }, lastSavedTime: '', lastSavedMs: now
    };
    patients.push(newP);
    input.value = '';
    render();
    writeFullFile();
}

function updateField(guid, field, value) {
    const p = patients.find(p => p.guid === guid);
    if (!p || p[field] === value) return;

    // BED VALIDATION: Prevent duplicates in active queue
    if (field === 'bed' && value !== '') {
        const isOccupied = patients.some(other => other.bed === value && other.guid !== guid && other.status !== 'discharged');
        if (isOccupied) {
            alert(`Bed ${value} is already occupied!`);
            render(); 
            return;
        }
    }

    historyStack.push(JSON.parse(JSON.stringify(p)));
    p[field] = value;
    if (field === 'status') calculateStats(p, value);
    render();
    writeFullFile();
}

function calculateStats(p, newS) {
    const now = Date.now();
    if (!p.logs[newS + "_first"]) p.logs[newS + "_first"] = now;
    p.logs[newS + "_latest"] = now;
    if (p.logs['checked-in_latest']) p.stats.checkIn = p.logs['checked-in_latest'] - p.timestamps.added;
    const readyFirst = p.logs['ready for procedure_first'];
    const intraLatest = p.logs['intra (IR-A)_latest'] || p.logs['intra (IR-B)_latest'];
    if (readyFirst && intraLatest) p.stats.preOp = intraLatest - readyFirst;
    const intraFirst = p.logs['intra (IR-A)_first'] || p.logs['intra (IR-B)_first'];
    if (intraFirst && p.logs['post-op_latest']) p.stats.proc = p.logs['post-op_latest'] - intraFirst;
    if (p.logs['post-op_first'] && p.logs['discharged_latest']) p.stats.postOp = p.logs['discharged_latest'] - p.logs['post-op_first'];
    p.stats.total = (p.logs['discharged_latest'] || now) - p.timestamps.added;
}

function render() {
    const activeBody = document.getElementById('activeBody');
    const discBody = document.getElementById('dischargedBody');
    const search = document.getElementById('searchInput').value.toLowerCase();
    activeBody.innerHTML = ''; discBody.innerHTML = '';
    
    let activeTotal = 0, dischargedTotal = 0;
    const initCounts = patients.reduce((acc, p) => { acc[p.initials] = (acc[p.initials] || 0) + 1; return acc; }, {});

    patients.forEach(p => {
        if (search && ![p.initials, p.procedure, p.notes].some(f => f.toLowerCase().includes(search))) return;
        const checkNeeded = (v) => (v === 'NEEDED' || v === 'NEEDED POST-OP' || v === '' || v === 'newly arrived') ? 'needed-highlight' : '';
        
        let sCls = '';
        if (p.status === 'newly arrived') sCls = 'status-newly';
        else if (p.status === 'ready for procedure') sCls = 'status-ready';
        else if (p.status.includes('intra')) sCls = 'status-intra';
        else sCls = 'status-' + p.status.split(' ')[0].replace('(', '');

        const row = `
            <tr class="${sCls}">
                <td class="${initCounts[p.initials] > 1 ? 'duplicate-warning' : ''}">${p.initials}</td>
                <td><select class="${checkNeeded(p.bed)}" onchange="updateField('${p.guid}', 'bed', this.value)">
                    ${['',8,9,10,11,12,13,14,15,16].map(b => `<option value="${b}" ${p.bed == b ? 'selected' : ''}>${b}</option>`).join('')}
                </select></td>
                <td><textarea class="auto-grow" oninput="autoExpand(this)" onblur="updateField('${p.guid}', 'procedure', this.value)">${p.procedure}</textarea></td>
                <td><select class="${checkNeeded(p.checkedIn)}" onchange="updateField('${p.guid}', 'checkedIn', this.value)">
                    ${['NEEDED', 'Yes (full)', 'Yes (continuity of care)', 'Not needed'].map(v => `<option ${p.checkedIn === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select></td>
                <td><select class="${checkNeeded(p.consented)}" onchange="updateField('${p.guid}', 'consented', this.value)">
                    ${['NEEDED', 'Done', 'Not Needed'].map(v => `<option ${p.consented === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select></td>
                <td><select class="${checkNeeded(p.iv)}" onchange="updateField('${p.guid}', 'iv', this.value)">
                    ${['NEEDED', 'In Situ', 'PICC', 'Port', 'Not Needed'].map(v => `<option ${p.iv === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select></td>
                <td><select class="${checkNeeded(p.status)}" onchange="updateField('${p.guid}', 'status', this.value)">
                    ${['newly arrived', 'checked-in', 'ready for procedure', 'intra (IR-A)', 'intra (IR-B)', 'post-op', 'discharged'].map(v => `<option ${p.status === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select></td>
                <td><textarea class="auto-grow" oninput="autoExpand(this)" onblur="updateField('${p.guid}', 'notes', this.value)">${p.notes}</textarea></td>
                <td><input type="text" value="${p.sedate}" onblur="updateField('${p.guid}', 'sedate', this.value)"></td>
                <td><input type="text" value="${p.scrub}" onblur="updateField('${p.guid}', 'scrub', this.value)"></td>
                <td><select class="${checkNeeded(p.report)}" onchange="updateField('${p.guid}', 'report', this.value)">
                    ${['NEEDED POST-OP', 'Report Given', 'Not Needed'].map(v => `<option ${p.report === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select></td>
                <td><select class="${checkNeeded(p.porter)}" onchange="updateField('${p.guid}', 'porter', this.value)">
                    ${['NEEDED POST-OP', 'Booked', 'Not Needed'].map(v => `<option ${p.porter === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select></td>
                <td style="white-space:nowrap">
                    Check-In: ${formatTimeDisplay(p.stats.checkIn)} | Pre-Op: ${formatTimeDisplay(p.stats.preOp)}<br>
                    Procedure: ${formatTimeDisplay(p.stats.proc)} | Post-Op: ${formatTimeDisplay(p.stats.postOp)}<br>
                    <strong>Total Duration: ${formatTimeDisplay(p.stats.total)}</strong>
                </td>
                <td class="no-print"><button class="delete-btn" onclick="deletePerson('${p.guid}')">❌</button></td>
                <td class="no-print"><button class="edit-btn" onclick="editInitials('${p.guid}')">✏️</button></td>
                <td style="font-size:8px">${p.lastSavedTime || '--'}</td>
            </tr>`;
        
        if (p.status === 'discharged') { discBody.innerHTML += row; dischargedTotal++; }
        else { activeBody.innerHTML += row; activeTotal++; }
    });
    document.getElementById('active-count').innerText = activeTotal;
    document.getElementById('discharged-count').innerText = dischargedTotal;
    document.querySelectorAll('textarea.auto-grow').forEach(el => autoExpand(el));
}

function editInitials(guid) {
    const p = patients.find(p => p.guid === guid);
    const newInit = prompt("Update initials (2 char max):", p.initials);
    if (newInit !== null) updateField(guid, 'initials', newInit.toUpperCase().substring(0, 2));
}

function deletePerson(guid) { if (confirm("Delete row?")) { patients = patients.filter(p => p.guid !== guid); render(); writeFullFile(); } }
function undoLastAction() { if (historyStack.length === 0) return; const prev = historyStack.pop(); patients[patients.findIndex(p => p.guid === prev.guid)] = prev; render(); writeFullFile(); }
function redoLastAction() { }
