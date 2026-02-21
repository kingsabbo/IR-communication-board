// --- Updated Stats Logic ---

function calculateStats(p, oldStatus, newStatus) {
    const now = Date.now();
    const diffMs = now - p.lastTransitionTime; // Keep raw milliseconds for precision
    
    // Check-in is special: time from creation to first check-in
    if (newStatus === 'checked-in') {
        p.stats.checkIn = now - p.timestamps.added;
    }
    
    // Pre-Op: Time spent in 'checked-in' or 'ready' before moving to 'intra'
    if ((oldStatus === 'checked-in' || oldStatus === 'ready for procedure') && newStatus.includes('intra')) {
        p.stats.preOp = diffMs;
    }
    
    // Proc: Time spent in 'intra' status
    if (oldStatus.includes('intra') && newStatus === 'post-op') {
        p.stats.proc = diffMs;
    }
    
    // Post-Op: Time spent in 'post-op' status
    if (oldStatus === 'post-op' && newStatus === 'discharged') {
        p.stats.postOp = diffMs;
    }
    
    p.lastTransitionTime = now;
}

// Helper function to format the display string
function formatTimeDisplay(ms) {
    if (!ms || ms <= 0) return "0 sec";
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds < 60) {
        return `${totalSeconds} sec`;
    } else {
        const mins = Math.round(totalSeconds / 60);
        return `${mins} min`;
    }
}

// --- Updated Render Function Snippet ---
// Locate the <td> in your render function that displays the stats and update it to this:

`<td>
    In: ${formatTimeDisplay(p.stats.checkIn)} | 
    Pre: ${formatTimeDisplay(p.stats.preOp)} | 
    Pro: ${formatTimeDisplay(p.stats.proc)} | 
    Po: ${formatTimeDisplay(p.stats.postOp)}
 </td>`
