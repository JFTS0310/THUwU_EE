const firebaseConfig = {
  apiKey: "AIzaSyBnq229MlVplzXrNMWe9ArSn3e3LKhap00",
  authDomain: "thu-ee-2e68d.firebaseapp.com",
  projectId: "thu-ee-2e68d",
  storageBucket: "thu-ee-2e68d.firebasestorage.app",
  messagingSenderId: "689191907568",
  appId: "1:689191907568:web:3dc3414c74c09a971c5235",
  measurementId: "G-CP2L4RVYD4"
};

if (location.search.includes("__debug__"))
    window.onerror = (...arg) => document.querySelector("footer").textContent = arg;

const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 3000,
    timerProgressBar: true,
    onOpen: (toast) => {
        toast.addEventListener('mouseenter', Swal.stopTimer)
        toast.addEventListener('mouseleave', Swal.resumeTimer)
    }
});

const hide = elem => elem.classList.add("is-hidden");
const show = elem => elem.classList.remove("is-hidden");

function debounce(func, delay) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => func.apply(this, args), delay);
    };
}

let courseData = {};
let selectedCourse = {};
let extraData = {};
let conflictGroups = {}; 
let deptIdToName = {};

const USER_TAGS_LIST = ["考試", "點名", "分組", "書面報告", "上台報告", "互動式", "禁電子產品", "筆記評分", "實地參訪"];

let userReviews = {};
try {
    userReviews = JSON.parse(localStorage.getItem("userReviews_v2")) || {};
} catch(e) { console.error(e); userReviews = {}; }

let blockedData = { teachers: [], courses: [] };
try {
    const localBlocked = JSON.parse(localStorage.getItem("blockedData"));
    if (localBlocked) {
        blockedData = localBlocked;
        if (!Array.isArray(blockedData.teachers)) blockedData.teachers = [];
        if (!Array.isArray(blockedData.courses)) blockedData.courses = [];
    }
} catch(e) { console.error(e); }

let filter = {
    department: false,
    departmentId: -1,
    departmentCode: null,
    period: false,
    periodCodes: [],
    tagFilters: {},
    grade: -1
};

let config = {};
let currentUser = null; 
let isDataLoaded = false;

let db = null;
let auth = null;

try {
    if (typeof firebase !== 'undefined' && firebaseConfig.apiKey) {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        } else {
            firebase.app(); 
        }
        auth = firebase.auth();
        db = firebase.firestore();
    } else {
        console.warn("Firebase SDK not loaded.");
    }
} catch (e) {
    console.error(e);
}

const supportBigInt = typeof BigInt !== 'undefined';
if (!supportBigInt) BigInt = JSBI.BigInt;

function parseBigInt(value, radix = 36) {
    const add = (a, b) => supportBigInt ? a + b : JSBI.add(a, b);
    const mul = (a, b) => supportBigInt ? a * b : JSBI.multiply(a, b);
    return [...value.toString()]
        .reduce((r, v) => add(
            mul(r, BigInt(radix)),
            BigInt(parseInt(v, radix))
        ), BigInt(0));
}

function loadFromShareLink() {
    const shareKey = new URLSearchParams(location.search).get("share");
    if (!shareKey) return {};
    const courseIds = parseBigInt(shareKey).toString().match(/.{1,4}/g);
    return courseIds ? courseIds.reduce((a, b) => (a[b] = true, a), {}) : {};
}

function loadFromLocalStorage() {
    return JSON.parse(localStorage.getItem("selectedCourse")) || {};
}

function updateCreditsUI() {
    let total = 0;
    let details = { "必修": 0, "選修": 0, "通識": 0, "其他": 0 };

    Object.keys(selectedCourse).forEach(id => {
        if (!courseData[id]) return;
        const cred = +courseData[id].credit;
        total += cred;
        
        const typeIndex = courseData[id].type; 
        if (typeIndex === 1) details["必修"] += cred;
        else if (typeIndex === 0) details["選修"] += cred;
        else if (typeIndex === 2) details["通識"] += cred;
        else details["其他"] += cred;
    });

    document.querySelector(".credits").textContent = `${total} 學分`;
    const tooltipText = `必修: ${details["必修"]} | 選修: ${details["選修"]} | 通識: ${details["通識"]} | 其他: ${details["其他"]}`;
    
    const tooltip = document.getElementById("credits-breakdown");
    if(tooltip) tooltip.textContent = tooltipText;
    document.querySelector(".credits").title = tooltipText;
}

let share = false;
if (location.search.includes("share=")) {
    share = true;
    hide(document.querySelector(".sidebar"));
    show(document.querySelector("#import"));
}

const styleFix = document.createElement('style');
styleFix.innerHTML = `
    .timetable { width: 100% !important; table-layout: fixed !important; }
    .timetable th, .timetable td { white-space: normal !important; word-wrap: break-word !important; overflow-wrap: break-word !important; text-align: center; vertical-align: middle !important; }
    .timetable th:first-child { width: 80px !important; max-width: 80px !important; padding: 4px 0 !important; }
    .timetable th:first-child div:first-child { font-size: 1.1rem; font-weight: bold; margin-bottom: 6px; }
    .timetable th:first-child div:last-child { font-size: 0.65rem !important; line-height: 1.1; color: #666; }
    .timetable td { width: auto !important; font-size: 0.9rem; padding: 4px !important; }
    .conflict-accordion .course { position: relative; } 
`;
document.head.appendChild(styleFix);

const periodOrder = [
  "A/07:10 ~ 08:00", "1/08:10 ~ 09:00", "2/09:10 ~ 10:00",
  "3/10:20 ~ 11:10", "4/11:20 ~ 12:10", "B/12:10 ~ 13:00",
  "5/13:10 ~ 14:00", "6/14:10 ~ 15:00", "7/15:20 ~ 16:10",
  "8/16:20 ~ 17:10", "9/17:20 ~ 18:10", "C/18:20 ~ 19:10",
  "D/19:20 ~ 20:10", "E/20:20 ~ 21:10", "F/21:20 ~ 22:10"
];

const periodDisplayMap = {
    "C": "10", "D": "11", "E": "12", "F": "13"
};

periodOrder.forEach(item => {
    const [period, timeRange] = item.split('/');
    const row = document.createElement("tr");
    const timeHeader = document.createElement('th');
    
    let displayPeriod = period;
    if (periodDisplayMap[period]) {
        displayPeriod = periodDisplayMap[period];
    }

    const codeDiv = document.createElement("div"); codeDiv.textContent = displayPeriod;
    const timeDiv = document.createElement("div"); timeDiv.textContent = timeRange;
    timeHeader.appendChild(codeDiv); timeHeader.appendChild(timeDiv);
    if (["A", "C", "D", "E", "F"].includes(period)) timeHeader.classList.add('extra');
    
    row.appendChild(timeHeader);
    document.querySelector(".timetable tbody").appendChild(row);

    for (let day = 1; day <= 7; ++day) {
        const periodCode = `${day}${period}`;
        const block = document.createElement('td');
        block.id = periodCode;
        if (day === 6 || day === 7) block.classList.add('weekend');
        if (["A", "C", "D", "E", "F"].includes(period)) block.classList.add('extra');

        const overlay = document.createElement("div");
        overlay.className = "find-empty-overlay";
        overlay.append(...['horizontal', 'vertical'].map(className => {
            const div = document.createElement("div"); div.className = className; div.dataset.periodCode = periodCode; return div;
        }));
        overlay.onclick = () => {
            const periodCode = overlay.parentNode.id;
            togglePeriodFilter(periodCode);
        };
        block.appendChild(overlay);
        row.appendChild(block);
    }
});

const settingOptions = [
    { key: "trimTimetable", description: "我不用早出晚歸", callback: value => value ? document.querySelectorAll(".extra").forEach(hide) : document.querySelectorAll(".extra").forEach(elem => (!elem.classList.contains("weekend") || !config.hideWeekend) && show(elem)) },
    { key: "hideWeekend", description: "我週末沒課", callback: value => value ? document.querySelectorAll(".weekend").forEach(hide) : document.querySelectorAll(".weekend").forEach(elem => (!elem.classList.contains("extra") || !config.trimTimetable) && show(elem)) },
    { key: "hideTag", description: "隱藏課程列表中的 tag", callback: value => { const cssSheet = document.getElementById("custom-style").sheet; value ? cssSheet.insertRule(".course .tag{display: none;}", 0) : cssSheet.cssRules.length && cssSheet.deleteRule(0) } },
    { key: "darkMode", description: "深色模式", callback: value => { value ? document.body.classList.add('dark-mode') : document.body.classList.remove('dark-mode') } }
];

renderConfig(settingOptions);
renderTagFilters(); 

const filterContainer = document.getElementById('user-tag-filter-container');
const filterHeader = filterContainer.querySelector('.filter-header');
const filterContent = filterContainer.querySelector('.filter-content');

if (filterHeader) {
    filterHeader.onclick = () => {
        if (filterContent.style.display === 'none') {
            filterContent.style.display = 'block';
            filterContainer.classList.add('is-expanded');
        } else {
            filterContent.style.display = 'none';
            filterContainer.classList.remove('is-expanded');
        }
    };
}

function buildDeptMap(data) {
    for (const key in data) {
        if (typeof data[key] === 'number') {
            deptIdToName[data[key]] = key;
        } else if (typeof data[key] === 'object' && data[key] !== null) {
            buildDeptMap(data[key]);
        }
    }
}

function filterDepartments(deptData, activeDepIds) {
    const filtered = {};
    let hasValidChild = false;

    for (const [key, value] of Object.entries(deptData)) {
        if (typeof value === 'number') {
            let isActive = false;
            if (activeDepIds.has(value)) {
                isActive = true;
            }
            
            if (isActive) {
                filtered[key] = value;
                hasValidChild = true;
            }
        } else if (typeof value === 'object' && value !== null) {
            const filteredChild = filterDepartments(value, activeDepIds);
            if (Object.keys(filteredChild).length > 0) {
                filtered[key] = filteredChild;
                hasValidChild = true;
            }
        }
    }
    return filtered;
}

Promise.all([
    `course-data/${YEAR}${SEMESTER}-data.json`,
    `course-data/department.json`,
    `course-data/course-extras.json`
].map(url => fetch(url).then(r => r.ok ? r.json() : {}))) 
    .then(response => {
        const [data, departmentRaw, extras] = response; 

        courseData = data;
        extraData = extras || {};
        
        Object.keys(courseData).forEach(id => {
            if (extraData[id]) {
                courseData[id] = { ...courseData[id], ...extraData[id] };
            }
        });

        if (departmentRaw) {
            buildDeptMap(departmentRaw);
        }

        selectedCourse = share ? loadFromShareLink() : loadFromLocalStorage();
        isDataLoaded = true;

        document.querySelector(".input").disabled = false;
        document.querySelector(".input").placeholder = "課號 / 課名 / 老師";
        updateCreditsUI(); 
        renderAllSelected();

        const activeDepIds = new Set();
        Object.values(courseData).forEach(course => {
            if (Array.isArray(course.dep)) {
                course.dep.forEach(id => activeDepIds.add(id));
            }
        });

        let deptDataToProcess = departmentRaw;
        if (departmentRaw && Object.keys(departmentRaw).length === 1 && typeof Object.values(departmentRaw)[0] === 'object') {
             deptDataToProcess = Object.values(departmentRaw)[0];
        }

        const filteredDeptData = filterDepartments(deptDataToProcess, activeDepIds);

        renderDepartment(filteredDeptData);
        renderSearchResult();
        
        if (currentUser) {
            loadUserDataFromCloud(currentUser.uid);
        }
    })
    .catch(err => {
        console.error(err);
        document.querySelector(".input").placeholder = "資料載入失敗，請檢查網路或檔案路徑";
    });

const authContainer = document.getElementById('auth-container');
const btnLogin = document.getElementById('btn-login');

if (auth) {
    auth.onAuthStateChanged(user => {
        if (user) {
            currentUser = user;
            renderUserUI(user);
            if (isDataLoaded) {
                loadUserDataFromCloud(user.uid);
            }
        } else {
            currentUser = null;
            renderLoginUI();
        }
    });

    if (btnLogin) {
        btnLogin.onclick = () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            auth.signInWithPopup(provider).catch(error => {
                console.error(error);
                Toast.fire({ icon: 'error', title: '登入失敗: ' + error.message });
            });
        };
    }
} else {
    if (authContainer) authContainer.innerHTML = '<span class="tag is-light is-warning">未設定雲端同步</span>';
}

function renderUserUI(user) {
    if (!authContainer) return;
    authContainer.innerHTML = `
        <div class="user-profile">
            <img src="${user.photoURL}" class="user-avatar" title="${user.displayName}">
             <span id="sync-status" class="is-size-7 has-text-grey">已自動同步</span>
            <button class="button is-small is-light" onclick="firebase.auth().signOut()">登出</button>
        </div>
    `;
}

function renderLoginUI() {
    if (!authContainer) return;
    authContainer.innerHTML = `
        <button class="button is-primary is-small" id="btn-login-action">
            <span class="icon"><i class="fab fa-google"></i></span>
            <span>登入同步</span>
        </button>
    `;
    const btn = document.getElementById('btn-login-action');
    if (btn && btnLogin) btn.onclick = btnLogin.onclick;
}

async function loadUserDataFromCloud(uid) {
    if (!db) return;
    try {
        const doc = await db.collection('users').doc(uid).get();
        if (doc.exists) {
            const data = doc.data();
            
            if (data.userReviews) {
                userReviews = data.userReviews;
                localStorage.setItem("userReviews_v2", JSON.stringify(userReviews));
            }
            if (data.blockedData) {
                blockedData = data.blockedData || {};
                localStorage.setItem("blockedData", JSON.stringify(blockedData));
            }
            if (data.selectedCourse) {
                selectedCourse = data.selectedCourse;
                localStorage.setItem("selectedCourse", JSON.stringify(selectedCourse));
            }
            
            if (isDataLoaded) {
                renderAllSelected();
                renderSearchResult();
                updateCreditsUI();
            }
            const status = document.getElementById('sync-status');
            if(status) status.textContent = "已從雲端載入";
        }
    } catch (e) {
        console.error(e);
        const status = document.getElementById('sync-status');
        if(status) status.textContent = "同步失敗";
    }
}

async function saveUserDataToCloud() {
    if (!currentUser || !db) return;
    
    const status = document.getElementById('sync-status');
    if(status) status.textContent = "同步中...";

    try {
        await db.collection('users').doc(currentUser.uid).set({
            userReviews: userReviews,
            blockedData: blockedData,
            selectedCourse: selectedCourse,
            lastUpdate: new Date()
        }, { merge: true });
        if(status) status.textContent = "已自動備份";
    } catch (e) {
        console.error(e);
        if(status) status.textContent = "備份失敗";
    }
}

function getReviewKey(course) {
    return `${course.name}|${course.teacher}`;
}

function setFilter(filterData) {
    Object.entries(filterData).forEach(([key, value]) => {
        if (key in filter) filter[key] = value;
        else throw `${key} not in filter!`;
    });
    renderSearchResult();
}

function togglePeriodFilter(periodCode) {
    const periodCodes = new Set(filter.periodCodes);
    periodCodes.has(periodCode) ? periodCodes.delete(periodCode) : periodCodes.add(periodCode);
    setFilter({ period: periodCodes.size !== 0, periodCodes: [...periodCodes] });
    document.getElementById("search-period").innerHTML = "";
    document.getElementById("search-period").append(
        ...[...periodCodes].map(code => createTag(code, 'is-info', elem => { elem.remove(); togglePeriodFilter(code); }))
    );
    const overlay = document.getElementById(periodCode).querySelector('.find-empty-overlay');
    if (overlay) overlay.classList.toggle('selected');
}

function renderConfig(options) {
    const storedConfig = JSON.parse(localStorage.getItem("timetableConfig")) || {};
    options.forEach(rule => {
        const label = document.createElement("label"); label.className = "checkbox";
        label.style.display = "block"; label.style.marginLeft = "10px";
        const checkbox = document.createElement("input"); checkbox.type = "checkbox";
        checkbox.onclick = ({ target }) => {
            config[rule.key] = target.checked;
            localStorage.setItem("timetableConfig", JSON.stringify(config));
            rule.callback(target.checked);
        };
        checkbox.checked = !!storedConfig[rule.key];
        label.appendChild(checkbox); label.append(" " + rule.description);
        const container = document.querySelector("#setting .dropdown-item");
        if (container) container.appendChild(label);
        config[rule.key] = checkbox.checked;
        rule.callback(checkbox.checked);
    });
    config = storedConfig;
}

function renderDepartment(departmentData) {
    if (!departmentData) return;
    
    const renderSelect = (id, options) => {
        const select = document.querySelector(`.department[data-level="${id}"]`);
        if (!select) return;
        select.parentElement.classList.remove('is-hidden');
        
        if (!options) options = {};

        select.innerHTML =
            (id === 1 ? "<option selected>全部開課單位</option>" : "<option disabled selected>選擇開課單位</option>") +
            Object.entries(options).map(
                ([name]) => `<option>${name}</option>`
            ).join('');
    };

    renderSelect(1, departmentData);

    document.querySelectorAll('select.department').forEach((elem, _, selects) =>
        elem.onchange = ({ target }) => {
            const level = +target.dataset.level;
            let currentValue;
            
            const rawText = elem.value;
            let extractedCode = null;
            if (rawText) {
                const match = rawText.match(/^([A-Za-z0-9]+)/); 
                if (match) extractedCode = match[1];
            }

            try {
                if (level === 1) {
                    if (elem.value === "全部開課單位") {
                        setFilter({ department: false, departmentId: -1, departmentCode: null });
                        if (selects[1]) hide(selects[1].parentElement);
                        if (selects[2]) hide(selects[2].parentElement);
                        return;
                    }
                    currentValue = departmentData[elem.value];
                }
                else if (level === 2)
                    currentValue = departmentData[selects[0].value][elem.value];
                else
                    currentValue = departmentData[selects[0].value][selects[1].value][elem.value];

                const hasNextLevel = (typeof currentValue === 'object' && currentValue !== null);
                
                if (hasNextLevel) {
                    renderSelect(level + 1, currentValue);
                } else {
                    setFilter({ 
                        department: true, 
                        departmentId: currentValue, 
                        departmentCode: extractedCode 
                    });
                }

                selects.forEach(select => {
                    if (+select.dataset.level > level + (hasNextLevel ? 1 : 0)) {
                        hide(select.parentElement);
                    }
                });
            } catch (err) {
                console.error(err);
                setFilter({ department: false, departmentId: -1, departmentCode: null });
            }
        }
    )
}

function getConflictColor(index) {
    const colors = ['#f14668', '#ff9f43', '#feca57', '#48dbfb', '#1dd1a1', '#5f27cd', '#54a0ff', '#ff6b6b'];
    return colors[index % colors.length];
}

function hasOverlap(id1, id2) {
    if (!courseData[id1] || !courseData[id2]) return false;
    const t1 = courseData[id1].time;
    const t2 = courseData[id2].time;
    return t1.some(t => t2.includes(t));
}

function buildConflictGraph(ids) {
    const adj = {};
    ids.forEach(id => adj[id] = []);
    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
            if (hasOverlap(ids[i], ids[j])) {
                adj[ids[i]].push(ids[j]);
                adj[ids[j]].push(ids[i]);
            }
        }
    }
    return adj;
}

function getConnectedComponents(ids, adj) {
    const visited = new Set();
    const components = [];

    ids.forEach(id => {
        if (!visited.has(id)) {
            const component = [];
            const stack = [id];
            visited.add(id);
            while (stack.length > 0) {
                const node = stack.pop();
                component.push(node);
                adj[node].forEach(neighbor => {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        stack.push(neighbor);
                    }
                });
            }
            components.push(component);
        }
    });
    return components;
}

function renderAllSelected() {
    updateCreditsUI();
    document.querySelectorAll(".timetable .period").forEach(elem => elem.remove());
    document.querySelectorAll('.course-list > .course').forEach(el => el.style.borderLeft = 'none');
    
    const selectedContainer = document.querySelector(".selected");
    if (selectedContainer) selectedContainer.innerHTML = '';
    
    conflictGroups = {}; 
    const ids = Object.keys(selectedCourse);
    const adj = buildConflictGraph(ids);
    const components = getConnectedComponents(ids, adj);

    const nonConflictCourses = [];
    const conflictComponents = [];

    components.forEach((comp, idx) => {
        if (comp.length === 1) {
            nonConflictCourses.push(comp[0]);
        } else {
            conflictComponents.push(comp);
            comp.forEach(id => {
                conflictGroups[id] = idx; 
            });
        }
    });

    nonConflictCourses.forEach(id => {
        if (courseData[id]) {
            const course = courseData[id];
            renderPeriodBlock(course);
            appendCourseElement(course);
        }
    });

    conflictComponents.forEach((comp, idx) => {
        const color = getConflictColor(idx);
        
        const details = document.createElement('details');
        details.className = 'conflict-accordion';
        details.style.borderColor = color;
        details.open = true; 

        const summary = document.createElement('summary');
        summary.textContent = `衝堂群組 #${idx + 1} (${comp.length} 堂課)`;
        summary.style.backgroundColor = color;
        summary.style.color = '#fff';
        
        details.appendChild(summary);
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'conflict-content';
        
        comp.forEach(id => {
            const course = courseData[id];
            if(course) {
                appendCourseElement(course, false, contentDiv);
                renderPeriodBlock(course, false, true, idx); 
            }
        });
        
        details.appendChild(contentDiv);
        selectedContainer.appendChild(details);
    });
}

function getCourseIdFromElement(element) {
    return element.closest('.course,.period').dataset.id;
}

document.addEventListener("click", function ({ target }) {
    if (target.classList.contains('toggle-course'))
        toggleCourse(getCourseIdFromElement(target));

    if (target.classList.contains('modal-launcher'))
        openModal(getCourseIdFromElement(target));
})

document.addEventListener("mouseover", function (event) {
    if (event.target.matches('.result .course, .result .course *')) {
        const courseId = getCourseIdFromElement(event.target);
        const result = courseData[courseId].time;
        result.forEach(period => {
            const block = document.getElementById(period);
            block?.querySelector(".period:not(.preview)")?.classList.add("has-background-danger", "has-text-white");
        });
        renderPeriodBlock(courseData[courseId], true);
    }
})

document.addEventListener("mouseout", function (event) {
    if (event.target.matches('.result .course, .result .course *')) {
        document.querySelectorAll('.timetable .period.preview').forEach(elem => elem.remove());
        document.querySelectorAll(".timetable .period").forEach(elem => elem.classList.remove("has-background-danger", "has-text-white"))
    }
})

const btnManageBlock = document.getElementById('btn-manage-blocklist');
if(btnManageBlock) {
    btnManageBlock.onclick = () => {
        let htmlContent = '<b>封鎖的老師:</b><br>';
        if(blockedData.teachers.length === 0) htmlContent += '<span class="has-text-grey is-size-7">無</span><br>';
        else {
            htmlContent += blockedData.teachers.map(t => 
                `<span class="tag is-danger is-light">${t} <button class="delete is-small" onclick="unblock('teacher', '${t}')"></button></span>`
            ).join(' ');
        }
        
        htmlContent += '<br><br><b>封鎖的課程(ID):</b><br>';
        if(blockedData.courses.length === 0) htmlContent += '<span class="has-text-grey is-size-7">無</span>';
        else {
            htmlContent += blockedData.courses.map(c => 
                `<span class="tag is-danger is-light">${c} <button class="delete is-small" onclick="unblock('course', '${c}')"></button></span>`
            ).join(' ');
        }

        Swal.fire({ title: '封鎖名單管理', html: htmlContent, showConfirmButton: true });
    };
}

const btnExportJson = document.getElementById('btn-export-json');
if (btnExportJson) {
    btnExportJson.onclick = () => {
        const dataToExport = {
            selectedCourse: selectedCourse,
            blockedData: blockedData,
            userReviews: userReviews,
            timestamp: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `thuwu-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };
}

const btnImportJson = document.getElementById('btn-import-json');
const fileInput = document.getElementById('file-import');
if (btnImportJson && fileInput) {
    btnImportJson.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                if (importedData.selectedCourse) {
                    selectedCourse = importedData.selectedCourse;
                    localStorage.setItem("selectedCourse", JSON.stringify(selectedCourse));
                }
                if (importedData.blockedData) {
                    blockedData = importedData.blockedData;
                    localStorage.setItem("blockedData", JSON.stringify(blockedData));
                }
                if (importedData.userReviews) {
                    userReviews = importedData.userReviews;
                    localStorage.setItem("userReviews_v2", JSON.stringify(userReviews));
                }
                renderAllSelected();
                renderSearchResult();
                Toast.fire({ icon: 'success', title: '匯入成功！' });
            } catch (err) {
                console.error(err);
                Toast.fire({ icon: 'error', title: '匯入失敗：檔案格式錯誤' });
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };
}

window.unblock = (type, value) => {
    if(type === 'teacher') blockedData.teachers = blockedData.teachers.filter(t => t !== value);
    else blockedData.courses = blockedData.courses.filter(c => c !== value);
    
    localStorage.setItem("blockedData", JSON.stringify(blockedData));
    Toast.fire({icon: 'success', title: '已解除封鎖'});
    renderSearchResult();
    Swal.close();
    saveUserDataToCloud();
};

function toggleBlock(type, value) {
    if(type === 'teacher') {
        if(!blockedData.teachers.includes(value)) blockedData.teachers.push(value);
    } else {
        if(!blockedData.courses.includes(value)) blockedData.courses.push(value);
    }
    localStorage.setItem("blockedData", JSON.stringify(blockedData));
    Toast.fire({ icon: 'warning', title: `已封鎖 ${value}`});
    renderSearchResult(); 
    document.querySelector('.modal').classList.remove('is-active');
    saveUserDataToCloud();
}

function openModal(courseId) {
    const modal = document.querySelector('.modal');
    modal.classList.add('is-active');
    const data = courseData[courseId];
    
    modal.querySelector('.card-header-title').textContent = data.name;
    modal.querySelector('#modal-id').textContent = data.id;
    modal.querySelector('#modal-credit').textContent = data.credit;
    
    const teacherName = data.teacher;
    const dcardLink = `https://www.dcard.tw/search?query=${encodeURIComponent(teacherName)}`;
    modal.querySelector('#modal-teacher').innerHTML = 
        `<a href="${dcardLink}" target="_blank" title="搜尋 Dcard">${teacherName} <i class="fas fa-external-link-alt is-size-7"></i></a>`;
    
    modal.querySelector('#modal-time').textContent = data.time.join(', ');
    
    let gradingText = "尚無資料 (請執行爬蟲更新)";
    if (data.grading) {
        gradingText = data.grading;
    }
    modal.querySelector('#modal-grading').textContent = gradingText;

    const thuCourseUrl = `https://course.thu.edu.tw/view/${YEAR}/${SEMESTER}/${data.id}`;
    const outlineBtn = modal.querySelector('#outline');
    outlineBtn.href = thuCourseUrl;
    outlineBtn.textContent = "前往查詢評分與綱要";

    const btnBlockCourse = modal.querySelector('#btn-block-course');
    const btnBlockTeacher = modal.querySelector('#btn-block-teacher');
    
    btnBlockCourse.onclick = () => { if(confirm(`確定要封鎖課程 ${data.name} 嗎？`)) toggleBlock('course', data.id); };
    btnBlockTeacher.onclick = () => { if(confirm(`確定要封鎖老師 ${teacherName} 嗎？`)) toggleBlock('teacher', teacherName); };

    loadUserReview(data); 
}

function loadUserReview(course) {
    const key = getReviewKey(course);
    
    if (!userReviews[key]) {
        userReviews[key] = { 
            rating: 0, 
            tags: [], 
            note: "", 
            semester: `${YEAR}-${SEMESTER}` 
        };
    }
    
    const review = userReviews[key];
    if (!review.semester) {
        review.semester = `${YEAR}-${SEMESTER}`;
    }

    const semesterHint = document.getElementById('review-semester-hint');
    if (review.semester !== `${YEAR}-${SEMESTER}`) {
        semesterHint.innerHTML = `<span class="history-badge">紀錄於 ${review.semester}</span>`;
    } else {
        semesterHint.innerHTML = "";
    }

    const stars = document.querySelectorAll('#star-rating .star');
    const starContainer = document.querySelector('#star-rating');
    const highlightStars = (count) => {
        stars.forEach((s, idx) => {
            if (idx < count) s.classList.add('is-active');
            else s.classList.remove('is-active');
        });
    };

    highlightStars(review.rating);
    stars.forEach((star, index) => {
        star.onmouseover = () => { highlightStars(index + 1); };
        star.onclick = () => { 
            review.rating = index + 1; 
            performAutoSave(key, review);
        };
    });
    starContainer.onmouseleave = () => { highlightStars(review.rating); };

    const tagContainer = document.getElementById('user-tags-container');
    tagContainer.innerHTML = '';
    USER_TAGS_LIST.forEach(tagName => {
        const label = document.createElement('label');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = tagName;
        if(review.tags.includes(tagName)) checkbox.checked = true;
        
        checkbox.onchange = (e) => {
            if(e.target.checked) { if(!review.tags.includes(tagName)) review.tags.push(tagName); } 
            else { review.tags = review.tags.filter(t => t !== tagName); }
            performAutoSave(key, review);
        };
        label.appendChild(checkbox); label.append(tagName);
        tagContainer.appendChild(label);
    });

    const noteArea = document.getElementById('user-note');
    const statusDiv = document.getElementById('save-status');
    noteArea.value = review.note;
    
    const newNoteArea = noteArea.cloneNode(true);
    noteArea.parentNode.replaceChild(newNoteArea, noteArea);
    
    newNoteArea.oninput = debounce((e) => {
        statusDiv.textContent = "儲存中...";
        review.note = e.target.value;
        performAutoSave(key, review);
    }, 1000); 
}

function performAutoSave(key, review) {
    const statusDiv = document.getElementById('save-status');
    userReviews[key] = review;
    localStorage.setItem("userReviews_v2", JSON.stringify(userReviews));
    
    renderSearchResult();
    renderAllSelected();
    saveUserDataToCloud();
    if(statusDiv) {
        statusDiv.textContent = "已暫存";
        setTimeout(() => { statusDiv.textContent = ""; }, 2000);
    }
}

function renderTagFilters() {
    const container = document.getElementById('user-tag-filters');
    if (!container) return;
    container.innerHTML = '';
    USER_TAGS_LIST.forEach(tagName => {
        const div = document.createElement('div'); div.className = 'tag-filter-item';
        const label = document.createElement('span'); label.textContent = tagName;
        const select = document.createElement('select'); select.className = 'tag-filter-select';
        select.innerHTML = `<option value="ignore">-</option><option value="include">顯示</option><option value="exclude">隱藏</option>`;
        select.onchange = (e) => { filter.tagFilters[tagName] = e.target.value; renderSearchResult(); };
        div.appendChild(label); div.appendChild(select); container.appendChild(div);
    });
}

function createTag(text, type, closeCallback) {
    const tag = document.createElement("span"); tag.className = `tag is-rounded ${type}`; tag.textContent = text;
    if (closeCallback) {
        const close = document.createElement("button"); close.className = "delete is-small";
        close.onclick = () => closeCallback(tag); tag.appendChild(close);
    }
    return tag;
}

function appendCourseElement(courses, search = false, container = null) {
    if (!Array.isArray(courses)) courses = [courses];
    const fragment = document.createDocumentFragment();
    courses.forEach(course => {
        const template = document.importNode(document.getElementById("courseTemplate").content, true);
        template.getElementById("type").textContent = COURSE_TYPE[course.type];
        const typeColor = course.type === 0 ? 'is-white' : course.type === 1 ? 'is-danger' : 'is-primary';
        template.getElementById("type").className = `tag is-rounded ${typeColor}`;
        template.getElementById("name").textContent = course.name;

        if (course.english) template.querySelector(".chips").appendChild(createTag("英文授課", "is-success"));
        
        if (course.gradeLevel) {
            template.querySelector(".chips").appendChild(createTag(course.gradeLevel.replace("年級以上", "+"), "is-dark grade-tag"));
        }

        course.brief_code.forEach(code => code in BERIEF_CODE && template.querySelector(".chips").appendChild(createTag(BERIEF_CODE[code], "is-warning")));
        
        const key = getReviewKey(course);
        const myReview = userReviews[key];
        
        if(myReview && myReview.tags.length > 0) {
            myReview.tags.forEach(t => { template.querySelector(".chips").appendChild(createTag(t, "is-link is-light")); });
        }
        if(myReview && myReview.rating > 0) {
             template.querySelector(".chips").appendChild(createTag(`★ ${myReview.rating}`, "is-warning is-light"));
        }

        template.getElementById("detail").textContent = `${course.id}・${course.teacher}・${+course.credit} 學分`;
        const courseEl = template.querySelector(".course");
        courseEl.dataset.id = course.id;
        
        if (!search && !container && conflictGroups[course.id] !== undefined) {
             // Conflict courses handled in accordion
        }

        template.querySelector(".toggle-course").classList.toggle('is-selected', course.id in selectedCourse)
        fragment.appendChild(template);
    });
    
    if (container) {
        container.appendChild(fragment);
    } else {
        const targetContainer = document.querySelector(search ? ".result" : ".selected");
        if (targetContainer) targetContainer.appendChild(fragment);
    }
}

function search(searchTerm) {
    if (!blockedData || !blockedData.courses || !blockedData.teachers) {
        console.warn("BlockedData structure invalid, search skipped.");
        return [];
    }

    const hasTagFilter = Object.values(filter.tagFilters).some(v => v !== 'ignore');
    if (!searchTerm && !(filter.department) && !(filter.period) && !hasTagFilter && filter.grade === -1) return [];
    const regex = RegExp(searchTerm, 'i');
    
    let result = Object.values(courseData).filter(course => {
        if (blockedData.courses.includes(course.id)) return false;
        if (blockedData.teachers.includes(course.teacher)) return false;

        let deptMatch = true;
        if (filter.department) {
            const idMatch = course.dep.some(d => d == filter.departmentId);
            const codeMatch = filter.departmentCode && course.dep.some(d => d == filter.departmentCode);
            deptMatch = idMatch || codeMatch;
        }

        let gradeMatch = true;
        if (filter.grade !== -1) {
            const userGrade = parseInt(filter.grade);
            let courseLimit = 1;
            if (course.gradeLevel) {
                const match = course.gradeLevel.match(/(\d+)年級以上/);
                if (match) courseLimit = parseInt(match[1]);
                else if (course.gradeLevel.includes("年級")) {
                     const exactMatch = course.gradeLevel.match(/(\d+)年級/);
                     if(exactMatch) courseLimit = parseInt(exactMatch[1]);
                }
            }
            if (userGrade < courseLimit) gradeMatch = false;
        }

        const basicMatch = (
            !searchTerm || course.id == searchTerm || course.teacher.match(regex) || course.name.match(regex)
        ) && deptMatch && gradeMatch && (!filter.period || course.time.some(code => filter.periodCodes.includes(code)));

        if (!basicMatch) return false;

        const key = getReviewKey(course);
        const myReview = userReviews[key];
        const myTags = myReview ? myReview.tags : [];

        for (const [tag, rule] of Object.entries(filter.tagFilters)) {
            if (rule === 'include') { if (!myTags.includes(tag)) return false; } 
            else if (rule === 'exclude') { if (myTags.includes(tag)) return false; }
        }
        return true;
    });
    
    return result;
}

function save() {
    localStorage.setItem("selectedCourse", JSON.stringify(selectedCourse));
    localStorage.setItem("lastUpdate", +new Date());
    saveUserDataToCloud();
}

function toggleCourse(courseId) {
    const button = document.querySelector(`.course[data-id="${courseId}"] .toggle-course`);
    if (courseId in selectedCourse) { 
        delete selectedCourse[courseId];
        const selectedEl = document.querySelector(`.selected [data-id="${courseId}"]`);
        if (selectedEl) selectedEl.remove();
        document.querySelectorAll(`.period[data-id="${courseId}"]`).forEach(elem => elem.remove());
        button?.classList.remove('is-selected');
    } else { 
        selectedCourse[courseId] = true;
        button?.classList.add('is-selected');
    }
    renderAllSelected();
    save();
    updateCreditsUI();
}

function renderPeriodBlock(course, preview = false, isConflict = false, conflictGroupIndex = null) {
    const periods = course.time;
    
    if (isConflict && !preview) {
        const color = getConflictColor(conflictGroupIndex);
        periods.forEach(period => {
            const blank = document.getElementById(period);
            if (!blank) return;
            
            let overlapCount = 0;
            for(const cid in selectedCourse) {
                if(courseData[cid] && courseData[cid].time.includes(period)) {
                    overlapCount++;
                }
            }

            if (overlapCount > 1) {
                let conflictBlock = blank.querySelector('.period.conflict-block');
                if(!conflictBlock) {
                    conflictBlock = document.createElement("div");
                    conflictBlock.className = "period conflict-block";
                    conflictBlock.style.backgroundColor = color;
                    conflictBlock.innerHTML = "<div>衝堂</div>";
                    blank.appendChild(conflictBlock);
                } else {
                     conflictBlock.style.backgroundColor = color;
                }
            } else {
                const existBlock = blank.querySelector(".period");
                if (!existBlock) {
                    const periodBlock = document.createElement("div");
                    periodBlock.dataset.id = course.id;
                    periodBlock.className = "period modal-launcher";
                    periodBlock.style.borderLeft = `5px solid ${color}`; 
                    
                    const textDiv = document.createElement("div");
                    textDiv.innerHTML = `${course.name}<br><small style="opacity: 0.8; font-size: 0.8em;">${course.teacher}</small>`;
                    textDiv.style.lineHeight = "1.2";
                    periodBlock.appendChild(textDiv);
                    blank.appendChild(periodBlock);
                }
            }
        });
        return;
    }

    const periodBlock = document.createElement("div");
    periodBlock.dataset.id = course.id;
    periodBlock.className = "period modal-launcher";
    if (preview) periodBlock.className += ' preview';
    
    const textDiv = document.createElement("div");
    textDiv.innerHTML = `${course.name}<br><small style="opacity: 0.8; font-size: 0.8em;">${course.teacher}</small>`;
    textDiv.style.lineHeight = "1.2";
    
    periodBlock.appendChild(textDiv);
    
    periods.forEach(period => {
        const blank = document.getElementById(period);
        if (!blank) return;
        
        if (!preview) {
            const conflict = blank.querySelector('.period.conflict-block');
            if(conflict) return;
        }

        const existBlock = blank.querySelector(".period");
        if (existBlock && existBlock.dataset.id === course.id) { existBlock.classList.remove("preview"); } 
        else if (!blank.querySelector(".period:not(.preview)")) { const clone = document.importNode(periodBlock, true); blank.appendChild(clone) }
    });
}

function renderSearchResult(searchTerm) {
    const resultContainer = document.querySelector(".result");
    if (!resultContainer) return;
    resultContainer.innerHTML = '';
    
    if (typeof searchTerm === 'undefined') searchTerm = document.querySelector(".input").value.trim();
    if (!searchTerm && !filter.department && !filter.period && Object.values(filter.tagFilters).every(v => v === 'ignore') && filter.grade === -1) return;

    const result = search(searchTerm);
    
    if (result.length === 0) {
        resultContainer.innerHTML = '<div style="padding: 1em; text-align: center; color: #888;">沒有符合的課程</div>';
        return;
    }

    const groups = {};
    result.forEach(c => {
        let deptName = "其他單位";
        if (c.dep && c.dep.length > 0) {
            deptName = deptIdToName[c.dep[0]] || "其他單位";
        }
        if(!groups[deptName]) groups[deptName] = [];
        groups[deptName].push(c);
    });

    for(let dept in groups) {
        const courses = groups[dept];
        const details = document.createElement('details');
        details.className = 'dept-group';
        details.open = true; 
        
        const summary = document.createElement('summary');
        summary.textContent = `${dept} (${courses.length})`;
        details.appendChild(summary);
        
        const content = document.createElement('div');
        appendCourseElement(courses, true, content);
        details.appendChild(content);
        
        resultContainer.appendChild(details);
    }
}

document.querySelector(".input").oninput = event => {
    const searchTerm = event.target.value.trim();
    if (searchTerm.includes("'")) document.querySelector(".result").textContent = "1064 - You have an error in your SQL syntax;";
    renderSearchResult(searchTerm);
}

document.getElementById("import").onclick = () => {
    Swal.fire({
        title: '匯入課表', text: "接下來將會覆蓋你目前的課表ㄛ，確定嗎？", icon: 'warning', showCancelButton: true, confirmButtonText: '匯入'
    }).then(result => {
        if (result.value) {
            save();
            Toast.fire({ title: `<a href=${APP_URL}>匯入完成！點此前往選課模擬</a>`, icon: "success" });
        }
    })
}

document.getElementById("copy-link").onclick = () => {
    const shareKey = BigInt(Object.keys(selectedCourse).join('')).toString(36);
    const link = `${APP_URL}?share=${shareKey}`;
    const copy = document.createElement("div"); copy.textContent = link; document.body.appendChild(copy);
    const textRange = document.createRange(); textRange.selectNode(copy);
    const selet = window.getSelection(); selet.removeAllRanges(); selet.addRange(textRange);
    try {
        document.execCommand('copy');
        Toast.fire({ title: `<a href="${link}" target="_blank">複製好了！點此可直接前往</a>`, icon: "success" });
    } catch (err) { console.log('Oops, unable to copy'); }
    document.body.removeChild(copy);
}

document.getElementById("download").onclick = () => {
    const node = document.getElementById('timetable')
    document.querySelectorAll(".period").forEach(elem => elem.innerHTML += `<p class="tmp">${courseData[elem.dataset.id].classroom}</p>`)
    domtoimage.toPng(node).then(function (dataUrl) {
            var link = document.createElement('a'); link.href = dataUrl; link.download = '課表.png';
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
            document.querySelectorAll(".period").forEach(elem => elem.querySelector(".tmp").remove())
    }).catch(function (error) { console.error('oops, something went wrong!', error); });
}

document.querySelector('.modal-background').onclick = document.querySelector('.card-header-icon').onclick = () => document.querySelector('.modal').classList.remove('is-active');

const btnAutoFill = document.getElementById('btn-auto-fill');
if (btnAutoFill) {
    btnAutoFill.onclick = () => {
        if (!extraData || Object.keys(extraData).length === 0) {
            Swal.fire({ icon: 'error', title: '資料未載入', text: '無法讀取 course-extras.json' });
            return;
        }
        openCompulsoryWizard();
    };
}

const btnClearTimetable = document.getElementById('btn-clear-timetable');
if(btnClearTimetable) {
    btnClearTimetable.onclick = () => {
        if(confirm("確定要清空目前的所有課程嗎？\n此動作無法復原！")) {
            selectedCourse = {};
            renderAllSelected();
            save();
            updateCreditsUI();
            Toast.fire({ icon: 'success', title: '課表已清空' });
        }
    }
}

document.getElementById('grade-filter').onchange = (e) => {
    filter.grade = parseInt(e.target.value);
    renderSearchResult();
};

function normalizeString(str) {
    if (!str) return "";
    return str.replace(/系/g, '').replace(/\s/g, '').toLowerCase();
}

function checkConflict(times) {
    if (!times || times.length === 0) return false;
    for (const id in selectedCourse) {
        if (courseData[id]) {
            const existingTimes = courseData[id].time;
            if (existingTimes.some(t => times.includes(t))) return true;
        }
    }
    return false;
}

function autoFillCompulsory(targetClass) {
    let count = 0;
    const cleanTarget = normalizeString(targetClass);
    
    Object.values(courseData).forEach(course => {
        if (course.type === 1) { 
            let shouldAdd = false;
            
            if (course.className) {
                if (course.className.includes('修') || course.className.includes('-') || course.className.includes(',')) return;
                
                const cName = normalizeString(course.className);
                if (cName === cleanTarget) {
                    shouldAdd = true;
                } else if (cleanTarget.startsWith(cName)) {
                    shouldAdd = true;
                }
            }
            if (shouldAdd) {
                if (!(course.id in selectedCourse)) {
                     if (!checkConflict(course.time)) {
                         selectedCourse[course.id] = true;
                         count++;
                     }
                }
            }
        }
    });
    
    renderAllSelected();
    save();
    updateCreditsUI();
    
    if (count > 0) Toast.fire({ icon: 'success', title: `成功加入 ${count} 門必修課` });
    else Toast.fire({ icon: 'info', title: `沒有新增任何課程 (可能已選或衝堂)` });
}

function openCompulsoryWizard() {
    const depts = new Set();
    const deptTree = {};

    Object.values(courseData).forEach(c => {
        if(c.type === 1 && c.className) {
             const parts = c.className.split(',');
             parts.forEach(rawName => {
                 let name = rawName.trim();
                 if (name.includes('修') || name.includes('-')) return;
                 if (c.className.includes(',')) return; 
                 
                 name = name.replace(/\s/g, ''); 
                 
                 const match = name.match(/^(.+?)(\d+)([A-Za-z]*)$/);
                 if(match) {
                     const d = match[1];
                     const g = match[2];
                     const cls = match[3];
                     
                     if (d.includes('學院') || d.includes('通識')) return;
                     
                     if(!deptTree[d]) deptTree[d] = {};
                     if(!deptTree[d][g]) deptTree[d][g] = new Set();
                     if(cls) deptTree[d][g].add(cls);
                 }
             });
        }
    });

    const deptOptions = Object.keys(deptTree).sort().map(d => `<option value="${d}">${d}</option>`).join('');

    Swal.fire({
        title: '選擇科系',
        html: `<select id="swal-dept" class="swal2-input">${deptOptions}</select>`,
        showCancelButton: true,
        confirmButtonText: '下一步'
    }).then(result => {
        if(result.value) {
            const selectedDept = document.getElementById('swal-dept').value;
            const grades = Object.keys(deptTree[selectedDept]).sort();
            const gradeOptions = grades.map(g => `<option value="${g}">${g}年級</option>`).join('');
            
            Swal.fire({
                title: '選擇年級',
                html: `<select id="swal-grade" class="swal2-input">${gradeOptions}</select>`,
                showCancelButton: true,
                confirmButtonText: '下一步'
            }).then(r2 => {
                if(r2.value) {
                    const selectedGrade = document.getElementById('swal-grade').value;
                    const classes = Array.from(deptTree[selectedDept][selectedGrade]).sort();
                    
                    if(classes.length > 0) {
                        const classOptions = classes.map(c => `<option value="${c}">${c}班</option>`).join('');
                         Swal.fire({
                            title: '選擇班級',
                            html: `<select id="swal-class" class="swal2-input">${classOptions}</select>`,
                            showCancelButton: true,
                            confirmButtonText: '加入'
                        }).then(r3 => {
                            if(r3.value) {
                                const selectedClass = document.getElementById('swal-class').value;
                                const target = `${selectedDept}${selectedGrade}${selectedClass}`;
                                autoFillCompulsory(target);
                            }
                        });
                    } else {
                        const target = `${selectedDept}${selectedGrade}`;
                        autoFillCompulsory(target);
                    }
                }
            })
        }
    });
}