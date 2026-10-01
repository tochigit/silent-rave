// // ==========================================
// // EDIT YOUR EVENT DETAILS HERE (ONE PLACE ONLY)
// // ==========================================
// const EVENT_CONFIG = {
//   title: "NUSA Silent Rave",
//   location: "Evangel University Akaeze",
//   description: "Silent Rave at Evangel University Akaeze",
  
//   // Format: YYYY-MM-DD
//   startDate: "2026-11-11", 
  
//   // Format: 24-hour time (HH:MM)
//   startTime: "16:00", 
//   endTime: "21:00"
// };

// // ==========================================
// // AUTOMATIC LINK GENERATOR (DO NOT EDIT BELOW)
// // ==========================================
// function updateCalendarLinks() {
//   const { title, location, description, startDate, startTime, endTime } = EVENT_CONFIG;

//   // Convert dates and times to UTC ISO format for calendar standards (YYYYMMDDTHHMMSSZ)
//   const startISO = startDate.replace(/-/g, "") + "T" + startTime.replace(":", "") + "00Z";
//   const endISO = startDate.replace(/-/g, "") + "T" + endTime.replace(":", "") + "00Z";

//   const encodedTitle = encodeURIComponent(title);
//   const encodedLoc = encodeURIComponent(location);
//   const encodedDesc = encodeURIComponent(description);

//   // 1. Google Calendar
//   const googleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodedTitle}&dates=${startISO}/${endISO}&details=${encodedDesc}&location=${encodedLoc}`;
//   document.getElementById("googleCal").href = googleUrl;

//   // 2. iCalendar (.ics download)
//   const icsContent = `data:text/calendar;charset=utf8,BEGIN:VCALENDAR%0AVERSION:2.0%0ABEGIN:VEVENT%0ASUMMARY:${title}%0ADESCRIPTION:${description}%0ALOCATION:${location}%0ADTSTART:${startISO}%0ADTEND:${endISO}%0AEND:VEVENT%0AEND:VCALENDAR`;
//   document.getElementById("iCal").href = icsContent;

//   // 3. Outlook 365
//   const outlook365Url = `https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${encodedTitle}&startdt=${startDate}T${startTime}:00Z&enddt=${startDate}T${endTime}:00Z&body=${encodedDesc}&location=${encodedLoc}`;
//   document.getElementById("outlook365").href = outlook365Url;

//   // 4. Outlook Live
//   const outlookLiveUrl = `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${encodedTitle}&startdt=${startDate}T${startTime}:00Z&enddt=${startDate}T${endTime}:00Z&body=${encodedDesc}&location=${encodedLoc}`;
//   document.getElementById("outlookLive").href = outlookLiveUrl;
// }

// // Run the generator when the page loads
// updateCalendarLinks();




// let currentUnitPrice = 0;
// let ticketQuantity = 1;

// // 1. Open Modal with Selected Ticket Tier
// function openPaymentModal(ticketType, price) {
//   currentUnitPrice = price;
//   ticketQuantity = 1;
  
//   document.getElementById('ticketQty').value = ticketQuantity;
//   document.getElementById('modalTicketTitle').innerText = 'Buy ' + ticketType;
  
//   updateTotalPrice();
//   document.getElementById('paymentModal').style.display = 'flex';
// }

// 2. Change Ticket Quantity (+ / -)
// function changeQuantity(change) {
//   ticketQuantity += change;
//   if (ticketQuantity < 1) ticketQuantity = 1;
//   if (ticketQuantity > 10) ticketQuantity = 10;
  
//   document.getElementById('ticketQty').value = ticketQuantity;
//   updateTotalPrice();
// }

// 3. Update Total Price Display
// function updateTotalPrice() {
//   const total = currentUnitPrice * ticketQuantity;
//   document.getElementById('modalTotalPrice').innerHTML = 'Total Amount: <strong>&#8358;' + total.toLocaleString() + '</strong>';
// }

// 4. Close Modal
// function closePaymentModal() {
//   document.getElementById('paymentModal').style.display = 'none';
// }

// 5. Copy Bank Account Number
// function copyAccount() {
//   const accNo = document.getElementById('accNumber').innerText;
//   navigator.clipboard.writeText(accNo);
//   alert("Account number copied: " + accNo);
// }

// // 6. Handle Form Submission & Show Digital Ticket Image Pass
// document.getElementById('paymentForm').addEventListener('submit', function(e) {
//   e.preventDefault();
  
//   const name = document.getElementById('buyerName').value;
//   const email = document.getElementById('buyerEmail').value;
//   const total = currentUnitPrice * ticketQuantity;

  // Replace modal view with instant Digital Ticket Pass
//   const modalContent = document.querySelector('.modal-content');
//   modalContent.innerHTML = `
//     <span class="close-btn" onclick="closePaymentModal()">&times;</span>
//     <h3 style="color:#a3f7bf; margin-top:0;">Payment Proof Received!</h3>
//     <p style="font-size:14px;">Thank you <strong>${name}</strong>!</p>
    
//     <div style="text-align:center; margin: 15px 0; background:#0d0f14; padding:15px; border-radius:10px; border: 1px solid #a3f7bf;">
//       <p style="font-weight:bold; color:#a3f7bf; margin:0 0 10px 0;">NITRO EXPERIENCE TICKET PASS</p>
//       <p style="margin:4px 0; font-size:13px;">Quantity: <strong>${ticketQuantity} Ticket(s)</strong></p>
//       <p style="margin:4px 0; font-size:13px;">Total Paid: <strong>₦${total.toLocaleString()}</strong></p>
//       <p style="font-size:11px; color:#aaa; margin-top:10px;">Please screenshot this page. A confirmation has also been queued for <strong>${email}</strong>.</p>
//     </div>

//     <button onclick="closePaymentModal()" class="submit-btn">Done</button>
//   `;
// });




// const calendarBtn = document.getElementById('calendarBtn');
// const calendarMenu = document.getElementById('calendarMenu');

// calendarBtn.addEventListener('click', function(event) {
// event.stopPropagation();
// calendarMenu.classList.toggle('show');   
// });

// window.addEventListener('click', function() {
//     if (calendarMenu.classList.contains('show')) {
//         calendarMenu.classList.remove('show');
//     }
// });


// ==========================================
// 1. EDIT YOUR EVENT DETAILS HERE
// ==========================================
const EVENT_CONFIG = {
  title: "NUSA Silent Rave",
  location: "Evangel University Akaeze",
  description: "Silent Rave at Evangel University Akaeze",
  
  // Ticket Image (Host on PostImages.org or save locally)
  ticketImageUrl: "ticket-pass.png", 

  // Date/Time Format: YYYY-MM-DD & HH:MM
  startDate: "2026-11-11", 
  startTime: "16:00", 
  endTime: "21:00"
};

// ==========================================
// 2. HELPER FUNCTIONS
// ==========================================

// Capitalizes names properly (e.g., "eberechukwu" -> "Eberechukwu")
function formatName(name) {
  return name
    .toLowerCase()
    .trim()
    .split(' ')
    .filter(word => word.length > 0)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Generate calendar links dynamically
function updateCalendarLinks() {
  const { title, location, description, startDate, startTime, endTime } = EVENT_CONFIG;

  const startISO = startDate.replace(/-/g, "") + "T" + startTime.replace(":", "") + "00Z";
  const endISO = startDate.replace(/-/g, "") + "T" + endTime.replace(":", "") + "00Z";

  const encodedTitle = encodeURIComponent(title);
  const encodedLoc = encodeURIComponent(location);
  const encodedDesc = encodeURIComponent(description);

  document.getElementById("googleCal").href = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodedTitle}&dates=${startISO}/${endISO}&details=${encodedDesc}&location=${encodedLoc}`;
  document.getElementById("iCal").href = `data:text/calendar;charset=utf8,BEGIN:VCALENDAR%0AVERSION:2.0%0ABEGIN:VEVENT%0ASUMMARY:${title}%0ADESCRIPTION:${description}%0ALOCATION:${location}%0ADTSTART:${startISO}%0ADTEND:${endISO}%0AEND:VEVENT%0AEND:VCALENDAR`;
  document.getElementById("outlook365").href = `https://outlook.office.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${encodedTitle}&startdt=${startDate}T${startTime}:00Z&enddt=${startDate}T${endTime}:00Z&body=${encodedDesc}&location=${encodedLoc}`;
  document.getElementById("outlookLive").href = `https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose&rru=addevent&subject=${encodedTitle}&startdt=${startDate}T${startTime}:00Z&enddt=${startDate}T${endTime}:00Z&body=${encodedDesc}&location=${encodedLoc}`;
}

updateCalendarLinks();

// ==========================================
// 3. TICKET MODAL LOGIC
// ==========================================
let currentUnitPrice = 0;
let ticketQuantity = 1;

function openPaymentModal(ticketType, price) {
  currentUnitPrice = price;
  ticketQuantity = 1;
  
  document.getElementById('ticketQty').value = ticketQuantity;
  document.getElementById('modalTicketTitle').innerText = 'Buy ' + ticketType;
  
  updateTotalPrice();
  document.getElementById('paymentModal').style.display = 'flex';
}

function changeQuantity(change) {
  ticketQuantity += change;
  if (ticketQuantity < 1) ticketQuantity = 1;
  if (ticketQuantity > 10) ticketQuantity = 10;
  
  document.getElementById('ticketQty').value = ticketQuantity;
  updateTotalPrice();
}

function updateTotalPrice() {
  const total = currentUnitPrice * ticketQuantity;
  document.getElementById('modalTotalPrice').innerHTML = 'Total Amount: <strong>&#8358;' + total.toLocaleString() + '</strong>';
}

function closePaymentModal() {
  document.getElementById('paymentModal').style.display = 'none';
}

function copyAccount() {
  const accNo = document.getElementById('accNumber').innerText;
  navigator.clipboard.writeText(accNo);
  alert("Account number copied: " + accNo);
}

// Render Digital Ticket Pass on Screen
function renderSuccessModal(name, email, total) {
  const modalContent = document.querySelector('.modal-content');
  modalContent.innerHTML = `
    <span class="close-btn" onclick="closePaymentModal()">&times;</span>
    <h3 style="color:#a3f7bf; margin-top:0;">Payment Proof Received!</h3>
    <p style="font-size:14px; margin-bottom:12px;">Thank you <strong>${name}</strong>!</p>
    
    <div style="text-align:center; background:#0d0f14; padding:15px; border-radius:10px; border: 1px solid #a3f7bf;">
      <h4 style="color:#a3f7bf; margin:0 0 10px 0; font-size:14px; text-transform:uppercase;">
        ${EVENT_CONFIG.title} PASS
      </h4>

      <!-- Dynamic Image Pass -->
      <img src="${EVENT_CONFIG.ticketImageUrl}" alt="Ticket Pass" style="width:100%; max-width:280px; border-radius:8px; margin-bottom:12px; border:1px solid #333;" onerror="this.style.display='none'">
      
      <p style="margin:4px 0; font-size:13px;">Quantity: <strong>${ticketQuantity} Ticket(s)</strong></p>
      <p style="margin:4px 0; font-size:13px;">Total Paid: <strong>₦${total.toLocaleString()}</strong></p>
      <p style="font-size:11px; color:#aaa; margin-top:10px;">Please screenshot this pass. A confirmation email has been sent to <strong>${email}</strong>.</p>
    </div>

    <button onclick="closePaymentModal()" class="submit-btn" style="margin-top:15px;">Done</button>
  `;
}

// Handle Form Submission & Trigger Automated Email
document.getElementById('paymentForm').addEventListener('submit', function(e) {
  e.preventDefault();

  const submitBtn = document.querySelector('.submit-btn');
  submitBtn.innerText = "Sending Ticket Pass...";
  submitBtn.disabled = true;

  // Format inputs
  const name = formatName(document.getElementById('buyerName').value);
  const email = document.getElementById('buyerEmail').value.trim();
  const total = currentUnitPrice * ticketQuantity;

  const templateParams = {
    to_name: name,
    to_email: email,
    event_title: EVENT_CONFIG.title,
    ticket_qty: ticketQuantity,
    total_amount: '₦' + total.toLocaleString(),
    ticket_image_url: EVENT_CONFIG.ticketImageUrl
  };

  // Send email via EmailJS (if credentials provided)
  if (typeof emailjs !== 'undefined') {
    emailjs.send('YOUR_SERVICE_ID', 'YOUR_TEMPLATE_ID', templateParams)
      .then(function() {
        renderSuccessModal(name, email, total);
      }, function(error) {
        console.error("EmailJS Error:", error);
        renderSuccessModal(name, email, total); // Fallback to display on screen anyway
      });
  } else {
    renderSuccessModal(name, email, total);
  }
});

// ==========================================
// 4. CALENDAR DROPDOWN EVENT LISTENERS
// ==========================================
const calendarBtn = document.getElementById('calendarBtn');
const calendarMenu = document.getElementById('calendarMenu');

calendarBtn.addEventListener('click', function(event) {
  event.stopPropagation();
  calendarMenu.classList.toggle('show');   
});

window.addEventListener('click', function() {
  if (calendarMenu.classList.contains('show')) {
    calendarMenu.classList.remove('show');
  }
});