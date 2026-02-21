let fileHandle;
let patients = [];

// --- Clock Logic ---
function updateClock() {
    const options = { 
        timeZone: 'America/Los_Angeles', 
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', 
        hour: '2-digit', minute: '2-digit' 
    };
    const clockEl = document.getElementById('pst-clock');
    if(clockEl) clockEl.innerText = new Date().toLocaleString('en-US', options) + " PST";
}
setInterval(updateClock, 1000);
updateClock();

// --- File System Operations ---
async function createNewDay() {
    const date = new Date();
    const fileName = `IR_Communication_Board_${date.getDate()}_${date.getMonth() + 1}_${date.getFullYear()}.csv`;
    
    try {
        fileHandle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{ description: 'CSV File', accept: { 'text/csv': ['.csv'] } }],
        });
        document.getElementById('board-filename').innerText = `Current board: ${fileHandle.name}`;
        document.getElementById('setup-overlay').style.display = 'none';
        saveToFile();
    } catch (err) { console.log("Save Picker cancelled"); }
}

async function loadExistingDay() {
    try {
        [fileHandle] = await window.showOpenFilePicker({
            types: [{ description: 'CSV File', accept: { 'text/csv': ['.csv'] } }],
            multiple: false
        });
        
        const file = await fileHandle.getFile();
        const content = await file.text();
        
        // Error handling for parsing
        try {
            parseCSV(content);
            document.getElementById('board-filename').innerText = `Current board: ${fileHandle.name}`;
            document.getElementById('setup-overlay').style.display = 'none';
            render();
        } catch (parseErr) {
            alert(`This file is not compatible. \n\nError: ${parseErr.message}`);
            fileHandle = null; // Reset handle if load fails
        }
        
    } catch (err) { console.log("Load Picker cancelled"); }
}

async function saveToFile() {
    if (!fileHandle) return;

    const now = new Date();
    const timeStr = now.getHours() + ":" + now.getMinutes().toString().padStart(2, '0');
    
    patients.forEach(p => p.lastSavedTime = timeStr);

    const headers = "initials,bed,procedure,checkedIn,consented,iv,status,notes,sedate,scrub,report,porter,stats_checkIn,stats_preOp,stats_proc,stats_postOp,guid,timestamps_added,lastTransitionTime,lastSavedTime\n";
    
    const rows = patients.map(p => [
        p.initials, p.bed, p.procedure, p.checkedIn, p.consented, p.iv, p.status, 
        `"${p.notes.replace(/"/g, '""')}"`, `"${p.sedate}"`, `"${p.scrub}"`, 
        p.report, p.porter, p.stats.checkIn, p.stats.preOp, 
        p.stats.proc, p.stats.postOp, p.guid, p.timestamps.added, p.lastTransitionTime, p.lastSavedTime
    ].join(",")).join("\n");

    try {
        const writable = await fileHandle.createWritable();
        await writable.write(headers + rows);
        await writable.close();
        document.getElementById('save-status').innerText = "Last Saved: " + timeStr;
    } catch (e) {
        document.getElementById('save-status').innerText = "Save Pending...";
    }
}

function parseCSV(text) {
    const lines = text.split("\n");
    const headerRow = lines[0].trim();
    
    // Basic validation: Check if the header matches our expected format
    if (!headerRow.includes("initials") || !headerRow.includes("guid")) {
        throw new Error("Missing required IR Board data columns.");
    }

    const dataLines = lines.slice(1);
    patients = dataLines.filter(line => line.trim() !== "").map((line, index) => {
        const parts = line.split(",");
        
        // Ensure the line has the expected number of columns (20)
        if (parts.length < 20) {
            throw new Error(`Line ${index + 2} is malformed or incomplete.`);
        }

        return {
            initials: parts[0], bed: parts[1], procedure: parts[2], checkedIn: parts[3],
            consented: parts[4], iv: parts[5], status: parts[6], notes: parts[7].replace(/"/g, ''),
            sedate: parts[8].replace(/"/g, ''), scrub: parts[9].replace(/"/g, ''),
            report: parts[10], porter: parts[11],
            stats: { checkIn: parts[12], preOp: parts[13], proc: parts[14], postOp: parts[15] },
            guid: parts[16], timestamps: { added: Number(parts[17]) },
            lastTransitionTime: Number(parts[18]), lastSavedTime: parts[19]
        };
    });
}

// --- App Functions ---
function addPerson() {
    const input = document.getElementById('newInitials');
    const initials = input.value.toUpperCase().trim();
    if (!initials) return;
    
    patients.push({
        guid: crypto.randomUUID(), initials, bed: '', procedure: '', checkedIn: 'No', consented: 'No',
        iv: 'No', status: 'arrived', notes: '', sedate: 'N/A', scrub: 'N/A', report: 'No', porter: '',
        timestamps: { added: Date.now() }, lastTransitionTime: Date.now(),
        stats: { checkIn: 0, preOp: 0, proc: 0, postOp: 0 }, lastSavedTime: ''
    });
    input.value = '';
    saveAndRender();
}

function updateField(guid, field, value) {
    const p = patients.find(p => p.guid === guid);
    if (!p) return;
    const oldStatus = p.status;
    
    if (field === 'status' && oldStatus !== value) calculateStats(p, oldStatus, value);
    p[field] = value;
    saveAndRender();
}

function calculateStats(p, oldStatus, newStatus) {
    const now = Date.now();
    const diff = Math.round((now - p.lastTransitionTime) / 60000);
    if (newStatus === 'checked-in') p.stats.checkIn = Math.round((now - p.timestamps.added) / 60000);
    if ((oldStatus === 'checked-in' || oldStatus === 'ready for procedure') && newStatus.includes('intra')) p.stats.preOp = diff;
    if (oldStatus.includes('intra') && newStatus === 'post-op') p.stats.proc = diff;
    if (oldStatus === 'post-op' && newStatus === 'discharged') p.stats.postOp = diff;
    p.lastTransitionTime = now;
}

function deletePerson(guid) {
    if (confirm("Remove this person?")) { patients = patients.filter(p => p.guid !== guid); saveAndRender(); }
}

function confirmReset() {
    if (confirm("Reset Board?") && confirm("Final Warning: Data will be wiped.")) { 
        patients = []; 
        document.getElementById('board-filename').innerText = "Current board: no file loaded";
        saveAndRender(); 
    }
}

function saveAndRender() { render(); saveToFile(); }

function render() {
    const activeBody = document.getElementById('activeBody');
    const discBody = document.getElementById('dischargedBody');
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    activeBody.innerHTML = ''; discBody.innerHTML = '';

    const initialCounts = patients.reduce((acc, p) => { acc[p.initials] = (acc[p.initials] || 0) + 1; return acc; }, {});

    patients.forEach(p => {
        if (![p.initials, p.procedure, p.notes].some(f => f.toLowerCase().includes(searchTerm))) return;
        
        let sCls = 'status-' + p.status.split(' ')[0].replace('(', '').replace(')', '');
        if (p.status === 'ready for procedure') sCls = 'status-ready';
        if (p.status.includes('intra')) sCls = 'status-intra';

        const isDup = initialCounts[p.initials] > 1;
        const rowHTML = `
            <tr class="${sCls}">
                <td class="${isDup ? 'duplicate-warning' : ''}">${p.initials}</td>
                <td><select onchange="updateField('${p.guid}', 'bed', this.value)">
                    ${['',8,9,10,11,12,13,14,15,16].map(b => `<option value="${b}" ${p.bed == b ? 'selected' : ''}>${b}</option>`).join('')}
                </select></td>
                <td><input type="text" value="${p.procedure}" onblur="updateField('${p.guid}', 'procedure', this.value)"></td>
                <td><select onchange="updateField('${p.guid}', 'checkedIn', this.value)">
                    <option ${p.checkedIn === 'No' ? 'selected' : ''}>No</option><option ${p.checkedIn === 'Yes' ? 'selected' : ''}>Yes</option>
                </select></td>
                <td><select onchange="updateField('${p.guid}', 'consented', this.value)">
                    ${['No','Yes','Not Needed'].map(v => `<option ${p.consented === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select></td>
                <td><select onchange="updateField('${p.guid}', 'iv', this.value)">
                    ${['No','Yes','N/A','PICC','Port'].map(v => `<option ${p.iv === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select></td>
                <td><select onchange="updateField('${p.guid}', 'status', this.value)">
                    ${['arrived','checked-in','ready for procedure','intra (IR-A)','intra (IR-B)','post-op','discharged'].map(v => `<option ${p.status === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select></td>
                <td><input type="text" value="${p.notes}" onblur="updateField('${p.guid}', 'notes', this.value)"></td>
                <td><input type="text" list="sedateList" value="${p.sedate}" onblur="updateField('${p.guid}', 'sedate', this.value)">
                    <datalist id="sedateList"><option value="N/A"></datalist></td>
                <td><input type="text" list="scrubList" value="${p.scrub}" onblur="updateField('${p.guid}', 'scrub', this.value)">
                    <datalist id="scrubList"><option value="N/A"></datalist></td>
                <td><select onchange="updateField('${p.guid}', 'report', this.value)">
                    <option ${p.report === 'No' ? 'selected' : ''}>No</option><option ${p.report === 'Yes' ? 'selected' : ''}>Yes</option>
                </select></td>
                <td><input type="text" list="pList" value="${p.porter}" onblur="updateField('${p.guid}', 'porter', this.value)">
                    <datalist id="pList"><option value="Booked"></datalist></td>
                <td>In:${p.stats.checkIn} | Pre:${p.stats.preOp} | Pro:${p.stats.proc} | Po:${p.stats.postOp}</td>
                <td class="no-print"><button class="delete-btn" onclick="deletePerson('${p.guid}')">×</button></td>
                <td class="last-saved-cell">${p.lastSavedTime}</td>
            </tr>`;
        
        if (p.status === 'discharged') discBody.innerHTML += rowHTML;
        else activeBody.innerHTML += rowHTML;
    });
}

window.onbeforeprint = () => {
    const opts = { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    document.getElementById('print-timestamp').innerText = new Date().toLocaleString('en-US', opts) + " PST";
};
