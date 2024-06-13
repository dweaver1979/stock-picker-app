let entryCounts = {};
let addedEntries = {};
let isAvailableChecked = false;
let isAuthenticated = false; // To track authentication status

function promptEmailDetails() {
    if (!isAvailableChecked) {
        alert("Please check availability before sending an email.");
        return;
    }
    // Adjust visibility based on the delivery or collection selection
    if (isDelivery) {
        document.getElementById('deliveryAddress').style.display = 'inline';
        document.getElementById('deliveryAddressLabel').style.display = 'inline';
    } else {
        document.getElementById('deliveryAddress').style.display = 'none';
        document.getElementById('deliveryAddressLabel').style.display = 'none';
    }
    document.getElementById('emailModal').style.display = 'block';
}

function submitEmailForm() {
    if (!validateInputs()) {
        alert("All fields must be filled out.");
        return;
    }

    const userEmail = document.getElementById('userEmail').value;
    const poNumber = document.getElementById('poNumber').value;
    const notes = document.getElementById('notes').value;
    const deliveryAddress = isDelivery ? document.getElementById('deliveryAddress').value : 'N/A';
    const collectionTime = !isDelivery ? document.getElementById('collectionTime').value : 'N/A';
    const collectionDepot = !isDelivery ? selectedDepot : '';

    sendEmail(userEmail, poNumber, notes, deliveryAddress, collectionDepot, collectionTime);
    document.getElementById('emailModal').style.display = 'none';
}

function sendEmail(userEmail, poNumber, notes, deliveryAddress, collectionDepot, collectionTime) {
    const entries = Object.keys(addedEntries).map(key => ({
        desc: addedEntries[key].desc,
        count: addedEntries[key].count
    }));

    if (entries.length === 0) {
        alert("No entries selected.");
        return;
    }

    fetch('http://localhost:3000/sendEmail', { // ### new hosting needs adding ####
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            email: 'support@idesystems.co.uk', // ### Email recipient will need to be altered to Rental@idesystems.co.uk ### 
            ccEmail: userEmail, 
            poNumber, 
            notes, 
            deliveryAddress, 
            entries,
            collectionDepot,
            collectionTime
        }),
    })
    .then(response => response.text())
    .then(data => {
        console.log(data); 
        alert("Email sent successfully!");
        isAvailableChecked = false;
        clearSelectedEntries(); 
    })
    .catch((error) => {
        console.error('Error:', error);
        alert("Failed to send email.");
    });
}

let selectedDepot = '';
let isDelivery = true;  

document.getElementById('choiceModal').style.display = 'block'; 

function confirmDepot() {
    selectedDepot = document.getElementById('depotSelectionModal').value;
    closeModal('depotModal');
    document.getElementById('depotSelection').value = selectedDepot; 
}

function requestCredentials() {
    const username = prompt("Please enter your username:");
    const password = prompt("Please enter your password:");

    if (username && password) {
        fetch('http://localhost:3000/login', { // ### new hosting needs adding ####
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username: username, password: password })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                document.getElementById('loginCover').style.display = 'none'; // Hide the login cover
                document.getElementById('passwordSection').style.display = 'block'; // Show the main content
            } else {
                alert("Login failed: " + data.message);
                requestCredentials(); // Re-prompt for credentials after a failed attempt
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert("Failed to verify credentials. Please try again.");
            requestCredentials(); // Re-prompt for credentials after an error
        });
    } else {
        alert("Username or password entry cancelled. Please try again.");
        requestCredentials(); // Re-prompt for credentials if either field was left blank
    }
}

function fetchData() {
    const searchQuery = document.getElementById('searchQuery').value;
    const depotSelection = document.getElementById('depotSelection').value;
    const searchTypes = Array.from(document.getElementById('searchType').selectedOptions).map(option => option.value);

    let searchType = searchTypes.includes("grpCode") ? "grpCode" : "desc";

    let fetchUrl = `http://localhost:3000/data?search=${searchQuery}&depot=${depotSelection}&searchType=${searchType}`; // ### new hosting needs adding ####

    fetch(fetchUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            displayEntries(data);
        })
        .catch(error => {
            console.error('Error fetching data: ', error);
            document.getElementById('dataDisplay').textContent = 'Failed to load data.';
        });
}

function checkAvailability() {
    const items = document.querySelectorAll('#selectedList > div');
    handleNextItem(0, items);
}

function handleNextItem(index, items) {
    if (index >= items.length) {
        const allAdjusted = Array.from(items).every(item => item.querySelector('.availability-check').innerHTML.includes('✔️'));
        isAvailableChecked = allAdjusted;
        if (isAvailableChecked) {
            displayPopup(true);
        } else {
            alert("Some items needed adjustments. Please review your order.");
        }
        return;
    }

    const item = items[index];
    const grpCode = item.getAttribute('data-grpcode');
    const selectedCount = parseInt(item.querySelector('.count').textContent, 10);
    const actualAvailableCount = entryCounts[grpCode] || 0;
    const checkSpan = item.querySelector('.availability-check');

    if (selectedCount <= actualAvailableCount) {
        checkSpan.innerHTML = ' ✔️';
        checkSpan.style.color = 'green';
        handleNextItem(index + 1, items);
    } else if (selectedCount > 0 && actualAvailableCount >= Math.ceil(0.7 * selectedCount)) {
        confirmPartialFulfillment(item, grpCode, selectedCount, actualAvailableCount)
            .then(result => {
                if (result) {
                    appendToNotes(grpCode, selectedCount, actualAvailableCount);
                    checkSpan.innerHTML = ' ✔️ Adjusted';
                    checkSpan.style.color = 'orange';
                } else {
                    checkSpan.innerHTML = ' ❌';
                    checkSpan.style.color = 'red';
                }
                handleNextItem(index + 1, items);
            });
    } else {
        checkSpan.innerHTML = ' ❌';
        checkSpan.style.color = 'red';
        handleNextItem(index + 1, items);
    }
}

function toggleDetails(itemId) {
    const detailSection = document.getElementById(itemId);
    detailSection.style.display = detailSection.style.display === "none" ? "block" : "none";
}

function displayPopup(allAvailable) {
    let modal = document.getElementById('availabilityModal');
    let span = document.getElementsByClassName("close-button")[0];
    let modalText = document.getElementById('modal-text');

    modalText.innerHTML = allAvailable ? 'Your order is ready to proceed!' : 'Sorry, we can\'t fill this order, please try again.';
    modalText.style.color = allAvailable ? 'green' : 'red';
    
    modal.style.display = "block";
    
    if (allAvailable) {
        setTimeout(() => {
            modal.style.display = "none";
            document.getElementById('emailModal').style.display = 'block';
        }, 2000);
    }

    span.onclick = function() {
        modal.style.display = "none";
    }
    
    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    }
}

function displayEntries(data) {
    let displayText = '<div>';
    entryCounts = {};
    for (const grpCode in data.randomData) {
        if (data.randomData.hasOwnProperty(grpCode)) {
            const representativeItem = data.randomData[grpCode][0];
            const totalCount = data.randomData[grpCode].reduce((acc, curr) => acc + (curr.stklevel || 0), 0);
            entryCounts[grpCode] = totalCount;

            const itemId = `group-${grpCode}`;
            displayText += `<div>
                                <h3>Asset: ${representativeItem.desc1}</h3>
                                <button onclick='addToSelectedList({"grpCode": "${grpCode}", "desc": "${representativeItem.desc1}"});'>Add</button>
                                <input type="number" id="quantity-${grpCode}" value="1" min="1" style="width: 60px;">

                                <div id="${itemId}" style="display:none; padding-left: 20px;">
                                    <p>Items in Group: ${totalCount}</p>
                                    <p>Depots with Asset: ${representativeItem.currdepot}</p>
                                </div>
                            </div>`;
        }
    }
    displayText += '</div>';
    document.getElementById('dataDisplay').innerHTML = displayText;
}

function addToSelectedList(item) {
    const grpCode = item.grpCode;
    const listItemID = `list-item-${grpCode}`;
    let listItem = document.getElementById(listItemID);
    
    const quantityInput = document.getElementById(`quantity-${grpCode}`);
    let quantity = parseInt(quantityInput.value, 10);

    if (!quantity || quantity <= 0) {
        alert("Invalid quantity.");
        return;
    }

    if (!addedEntries[grpCode]) {
        addedEntries[grpCode] = { desc: item.desc, count: quantity };
    } else {
        addedEntries[grpCode].count += quantity;
    }

    if (!listItem) {
        listItem = document.createElement('div');
        listItem.id = listItemID;
        listItem.setAttribute('data-grpcode', grpCode);
        listItem.innerHTML = `
            <strong>${item.desc}</strong>: <span class="count">${addedEntries[grpCode].count}</span> selected
            <button onclick='removeEntry("${grpCode}")'>Remove</button>
            <span class="availability-check"></span>`;

        document.getElementById('selectedList').appendChild(listItem);
    } else {
        const countSpan = listItem.querySelector('.count');
        countSpan.textContent = addedEntries[grpCode].count;
    }
}

function clearSelectedEntries() {
    addedEntries = {};
    document.getElementById('selectedList').innerHTML = '<h2>Selected Items: <i class="fas fa-trash-alt" onclick="clearSelectedEntries()" style="cursor: pointer;"></i></h2>';
}

function confirmPartialFulfillment(item, grpCode, requestedCount, availableCount) {
    return new Promise((resolve) => {
        if (confirm(`Item ${item.querySelector('strong').textContent} can be partially filled. ${availableCount} can be provided out of requested ${requestedCount}. Do you want to adjust the order to the available amount?`)) {
            item.querySelector('.count').textContent = availableCount;
            addedEntries[grpCode].count = availableCount;
            item.querySelector('.availability-check').innerHTML = ' ✔️ Adjusted';
            item.querySelector('.availability-check').style.color = 'green';
            resolve(true);
        } else {
            resolve(false);
        }
    });
}

function appendToNotes(grpCode, requestedCount, availableCount) {
    const notesField = document.getElementById('notes');
    let existingNotes = notesField.value;
    existingNotes += `\nCouldn't fulfil entire order for ${grpCode}: Requested ${requestedCount}, provided ${availableCount}.`;
    notesField.value = existingNotes.trim();
}

function removeEntry(grpCode) {
    const listItemID = `list-item-${grpCode}`;
    const listItem = document.getElementById(listItemID);

    if (listItem && addedEntries[grpCode] && addedEntries[grpCode].count > 1) {
        addedEntries[grpCode].count -= 1;
        listItem.querySelector('.count').textContent = addedEntries[grpCode].count;
    } else if (listItem && addedEntries[grpCode].count === 1) {
        listItem.remove();
        delete addedEntries[grpCode];
    }
}

function confirmAndGo() {
    checkAvailability();
}

function validateInputs() {
    const userEmail = document.getElementById('userEmail').value;
    const poNumber = document.getElementById('poNumber').value;
    const notes = document.getElementById('notes').value;
    const deliveryAddress = isDelivery ? document.getElementById('deliveryAddress').value : true;
    const collectionTime = !isDelivery ? document.getElementById('collectionTime').value : true;

    return userEmail && poNumber && notes && deliveryAddress && collectionTime;
}

function setDelivery() {
    isDelivery = true;
    document.getElementById('deliveryAddress').style.display = 'inline';
    document.getElementById('deliveryAddressLabel').style.display = 'inline';
    document.getElementById('collectionTimeContainer').style.display = 'none';
    closeModal('choiceModal');
}

function setCollection() {
    isDelivery = false;
    document.getElementById('deliveryAddress').style.display = 'none';
    document.getElementById('deliveryAddressLabel').style.display = 'none';
    document.getElementById('collectionTimeContainer').style.display = 'block';
    closeModal('choiceModal');
    document.getElementById('depotModal').style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}
