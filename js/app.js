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
let gradingData = {}; 

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
    tagFilters: {} 
};

let config = {};
let currentUser = null; 

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
`;
document.head.appendChild(styleFix);

const periodOrder = [
  "A/07:10 ~ 08:00", "1/08:10 ~ 09:00", "2/09:10 ~ 10:00",
  "3/10:20 ~ 11:10", "4/11:20 ~ 12:10", "B/12:10 ~ 13:00",
  "5/13:10 ~ 14:00", "6/14:10 ~ 15:00", "7/15:20 ~ 16:10",
  "8/16:20 ~ 17:10", "9/17:20 ~ 18:10", "C/18:20 ~ 19:10",
  "D/19:20 ~ 20:10", "E/20:20 ~ 21:10", "F/21:20 ~ 22:10"
];

periodOrder.forEach(item => {
    const [period, timeRange] = item.split('/');
    const row = document.createElement("tr");
    const timeHeader = document.createElement('th');
    
    const codeDiv = document.createElement("div"); codeDiv.textContent = period;
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
    `course-data/grading-data.json` 
].map(url => fetch(url).then(r => r.ok ? r.json() : {}))) 
    .then(response => {
        const [data, departmentRaw, grading] = response; 

        courseData = data;
        gradingData = grading || {}; 
        selectedCourse = share ? loadFromShareLink() : loadFromLocalStorage();

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
             <button class="button is-small is-primary is-light" id="btn-cloud-save" title="將目前課表上傳到雲端備份">
                <span class="icon"><i class="fas fa-cloud-upload-alt"></i></span>
                <span>上傳備份</span>
            </button>
            <button class="button is-small is-info is-light" id="btn-cloud-load" title="從雲端讀取備份並覆蓋本地進度">
                <span class="icon"><i class="fas fa-cloud-download-alt"></i></span>
                <span>讀取備份</span>
            </button>
            <button class="button is-small is-light" onclick="firebase.auth().signOut()">登出</button>
        </div>
    `;
    
    document.getElementById('btn-cloud-load').onclick = () => {
        if(confirm("確定要從雲端讀取進度嗎？\n這將會覆蓋你目前尚未儲存的變更！")) {
            loadUserDataFromCloud(user.uid);
        }
    };

    document.getElementById('btn-cloud-save').onclick = () => {
        saveUserDataToCloud();
    };
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
    Toast.fire({ title: '正在讀取雲端資料...', icon: 'info' });
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
                if (!Array.isArray(blockedData.teachers)) blockedData.teachers = [];
                if (!Array.isArray(blockedData.courses)) blockedData.courses = [];
                localStorage.setItem("blockedData", JSON.stringify(blockedData));
            }
            if (data.selectedCourse) {
                selectedCourse = data.selectedCourse;
                localStorage.setItem("selectedCourse", JSON.stringify(selectedCourse));
                renderAllSelected();
            }
            Toast.fire({ title: '下載完成！', icon: 'success' });
            renderSearchResult();
        } else {
            Toast.fire({ title: '雲端尚無存檔', icon: 'warning' });
        }
    } catch (e) {
        console.error(e);
        Toast.fire({ title: '讀取失敗 (請檢查權限或網路)', icon: 'error' });
    }
}

async function saveUserDataToCloud() {
    if (!currentUser || !db) return;
    
    Toast.fire({ title: '正在上傳備份...', icon: 'info' });
    try {
        await db.collection('users').doc(currentUser.uid).set({
            userReviews: userReviews,
            blockedData: blockedData,
            selectedCourse: selectedCourse,
            lastUpdate: new Date()
        }, { merge: true });
        console.log("Manual saved to cloud");
        Toast.fire({ title: '備份成功！', icon: 'success' });
    } catch (e) {
        console.error(e);
        Toast.fire({ title: '上傳失敗 (請檢查權限或網路)', icon: 'error' });
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

function renderAllSelected() {
    updateCreditsUI();
    document.querySelectorAll(".timetable .period").forEach(elem => elem.remove())
    const selectedContainer = document.querySelector(".selected");
    if (selectedContainer) selectedContainer.innerHTML = '';
    
    for (courseId in selectedCourse) {
        if(courseData[courseId]) {
            const course = courseData[courseId];
            renderPeriodBlock(course);
            appendCourseElement(course);
        }
    }
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

window.unblock = (type, value) => {
    if(type === 'teacher') blockedData.teachers = blockedData.teachers.filter(t => t !== value);
    else blockedData.courses = blockedData.courses.filter(c => c !== value);
    
    localStorage.setItem("blockedData", JSON.stringify(blockedData));
    Toast.fire({icon: 'success', title: '已解除封鎖 (記得備份到雲端)'});
    renderSearchResult();
    Swal.close();
};

function toggleBlock(type, value) {
    if(type === 'teacher') {
        if(!blockedData.teachers.includes(value)) blockedData.teachers.push(value);
    } else {
        if(!blockedData.courses.includes(value)) blockedData.courses.push(value);
    }
    localStorage.setItem("blockedData", JSON.stringify(blockedData));
    Toast.fire({ icon: 'warning', title: `已封鎖 ${value} (記得備份到雲端)`});
    renderSearchResult(); 
    document.querySelector('.modal').classList.remove('is-active'); 
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
    
    const gradingText = gradingData[courseId] ? gradingData[courseId] : "尚無資料 (請確認是否已匯入)";
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
    if(statusDiv) {
        statusDiv.textContent = "已暫存於本地 (記得上傳備份)";
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

function appendCourseElement(courses, search = false) {
    if (!Array.isArray(courses)) courses = [courses];
    const fragment = document.createDocumentFragment();
    courses.forEach(course => {
        const template = document.importNode(document.getElementById("courseTemplate").content, true);
        template.getElementById("type").textContent = COURSE_TYPE[course.type];
        const typeColor = course.type === 0 ? 'is-white' : course.type === 1 ? 'is-danger' : 'is-primary';
        template.getElementById("type").className = `tag is-rounded ${typeColor}`;
        template.getElementById("name").textContent = course.name;

        if (course.english) template.querySelector(".chips").appendChild(createTag("英文授課", "is-success"));
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
        template.querySelector(".course").dataset.id = course.id;
        template.querySelector(".toggle-course").classList.toggle('is-selected', course.id in selectedCourse)
        fragment.appendChild(template);
    });
    const container = document.querySelector(search ? ".result" : ".selected");
    if (container) container.appendChild(fragment);
}

function search(searchTerm) {
    if (!blockedData || !blockedData.courses || !blockedData.teachers) {
        console.warn("BlockedData structure invalid, search skipped.");
        return [];
    }

    const hasTagFilter = Object.values(filter.tagFilters).some(v => v !== 'ignore');
    if (!searchTerm && !(filter.department) && !(filter.period) && !hasTagFilter) return [];
    const regex = RegExp(searchTerm, 'i');
    
    const result = Object.values(courseData).filter(course => {
        if (blockedData.courses.includes(course.id)) return false;
        if (blockedData.teachers.includes(course.teacher)) return false;

        let deptMatch = true;
        if (filter.department) {
            const idMatch = course.dep.some(d => d == filter.departmentId);
            const codeMatch = filter.departmentCode && course.dep.some(d => d == filter.departmentCode);
            
            deptMatch = idMatch || codeMatch;
        }

        const basicMatch = (
            !searchTerm || course.id == searchTerm || course.teacher.match(regex) || course.name.match(regex)
        ) && deptMatch && (!filter.period || course.time.some(code => filter.periodCodes.includes(code)));

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
        const periods = courseData[courseId].time;
        const isConflict = periods.some(period => {
            const block = document.getElementById(period);
            if (!block) return false; 
            return block.querySelector(".period:not(.preview)");
        });
        
        if (isConflict) { Toast.fire({ icon: 'error', title: "和目前課程衝堂了欸" }); return; }
        selectedCourse[courseId] = true;
        appendCourseElement(courseData[courseId]);
        renderPeriodBlock(courseData[courseId]);
        button?.classList.add('is-selected');
    }
    save();
    updateCreditsUI();
}

function renderPeriodBlock(course, preview = false) {
    const periods = course.time;
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
    const result = search(searchTerm);
    appendCourseElement(result, true);
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
