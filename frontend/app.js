/* ═══════════════════════════════════════════════════════════════
   Meal Planner & Shopping List — app.js
   ═══════════════════════════════════════════════════════════════ */

const CATEGORIES = ["Produce", "Meat & Fish", "Dairy & Eggs", "Bakery", "Store Cupboard", "Frozen", "Drinks", "Other"];

const state = {
  recipes: [],
  staples: [],
  suggestions: [],
  planSelections: {},      // recipe_id -> nights
  currentShoppingList: null,
  checkedItems: {},        // persisted per-plan checked state
  macroPlan: null,
  pendingRecipePhoto: null, // File object staged for a not-yet-created recipe
};

// ── API helper ────────────────────────────────────────────────────────────

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function apiUpload(path, file, method = "POST") {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(path, { method, body: formData });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  return res.json();
}

// ── Toast ─────────────────────────────────────────────────────────────────

let toastTimer;
function toast(msg, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.toggle("toast-error", isError);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

// ── Tabs ──────────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === `tab-${tab}`));
}

// ── Modals ────────────────────────────────────────────────────────────────

function openModal(id) { document.getElementById(id).classList.add("show"); }
function closeModal(id) { document.getElementById(id).classList.remove("show"); }

function initModals() {
  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll(".modal-backdrop").forEach(bd => {
    bd.addEventListener("click", e => { if (e.target === bd) closeModal(bd.id); });
  });
}

// ── Macro helpers (mirrors backend logic for live preview) ─────────────────

function computeMacros(calories, carbs, fat, protein) {
  const macroCals = carbs * 4 + fat * 9 + protein * 4;
  const totalCals = calories || macroCals;
  if (totalCals <= 0) return { calories: 0, carb_pct: 0, fat_pct: 0, protein_pct: 0, is_high_carb_low_fat: false };
  const carb_pct = Math.round((carbs * 4 / totalCals) * 1000) / 10;
  const fat_pct = Math.round((fat * 9 / totalCals) * 1000) / 10;
  const protein_pct = Math.round((protein * 4 / totalCals) * 1000) / 10;
  return {
    calories: Math.round(totalCals * 10) / 10, carb_pct, fat_pct, protein_pct,
    is_high_carb_low_fat: fat_pct <= 20 && carb_pct >= 55,
  };
}

// ── Recipes ───────────────────────────────────────────────────────────────

async function loadRecipes() {
  state.recipes = await api("/api/recipes");
  renderRecipes();
}

function renderRecipes() {
  const container = document.getElementById("recipeList");
  if (state.recipes.length === 0) {
    container.innerHTML = `<p class="empty-state">No recipes yet — add your first one.</p>`;
    return;
  }
  container.innerHTML = state.recipes.map(r => `
    <div class="recipe-card">
      ${r.photo_path ? `<img class="recipe-photo" src="${r.photo_path}" alt="${escapeAttr(r.name)}">` : ""}
      <div class="recipe-card-header">
        <h3>${escapeHtml(r.name)}</h3>
        ${r.macros.is_high_carb_low_fat ? '<span class="badge badge-hclf">HCLF</span>' : ""}
      </div>
      <p class="muted small">Serves ${r.servings}${r.macros.calories ? ` · ${r.macros.calories} kcal/serving` : ""}</p>
      <div class="macro-bar">
        <span class="macro-chip macro-carb">Carbs ${r.macros.carb_pct}%</span>
        <span class="macro-chip macro-fat">Fat ${r.macros.fat_pct}%</span>
        <span class="macro-chip macro-protein">Protein ${r.macros.protein_pct}%</span>
      </div>
      <p class="ingredient-count">${r.ingredients.length} ingredient${r.ingredients.length === 1 ? "" : "s"}</p>
      <div class="card-actions">
        <button class="btn btn-small" data-edit-recipe="${r.id}">Edit</button>
        <button class="btn btn-small btn-danger" data-delete-recipe="${r.id}">Delete</button>
      </div>
    </div>
  `).join("");

  container.querySelectorAll("[data-edit-recipe]").forEach(btn => {
    btn.addEventListener("click", () => openRecipeModal(Number(btn.dataset.editRecipe)));
  });
  container.querySelectorAll("[data-delete-recipe]").forEach(btn => {
    btn.addEventListener("click", () => deleteRecipe(Number(btn.dataset.deleteRecipe)));
  });
}

function ingredientRowHtml(ing = {}) {
  const catOptions = CATEGORIES.map(c => `<option value="${c}" ${ing.category === c ? "selected" : ""}>${c}</option>`).join("");
  return `
    <div class="ingredient-row">
      <input type="text" class="ing-name" placeholder="Ingredient" value="${escapeAttr(ing.name || "")}">
      <input type="number" class="ing-qty" placeholder="Qty" min="0" step="any" value="${ing.quantity ?? ""}">
      <input type="text" class="ing-unit" placeholder="Unit" value="${escapeAttr(ing.unit || "")}">
      <select class="ing-category">${catOptions}</select>
      <button type="button" class="btn btn-small btn-danger ing-remove">&times;</button>
    </div>
  `;
}

function addIngredientRow(ing) {
  const wrap = document.getElementById("ingredientRows");
  const div = document.createElement("div");
  div.innerHTML = ingredientRowHtml(ing);
  const row = div.firstElementChild;
  row.querySelector(".ing-remove").addEventListener("click", () => row.remove());
  wrap.appendChild(row);
}

function renderRecipePhotoPreview(photoUrl) {
  const container = document.getElementById("recipePhotoPreview");
  document.getElementById("recipePhotoInput").value = "";
  if (!photoUrl) {
    container.innerHTML = `<p class="muted small">No photo yet.</p>`;
    return;
  }
  container.innerHTML = `
    <div class="photo-preview-wrap">
      <img src="${photoUrl}" alt="Recipe photo" class="photo-preview">
      <button type="button" class="btn btn-small btn-danger" id="btnRemoveRecipePhoto">Remove photo</button>
    </div>
  `;
  const removeBtn = document.getElementById("btnRemoveRecipePhoto");
  if (removeBtn) {
    removeBtn.addEventListener("click", async () => {
      const id = document.getElementById("recipeId").value;
      if (id) {
        try {
          await api(`/api/recipes/${id}/photo`, { method: "DELETE" });
          await loadRecipes();
          renderRecipePhotoPreview(null);
          toast("Photo removed");
        } catch (e) {
          toast(e.message, true);
        }
      } else {
        state.pendingRecipePhoto = null;
        renderRecipePhotoPreview(null);
      }
    });
  }
}

function openRecipeModal(recipeId = null) {
  document.getElementById("recipeId").value = recipeId || "";
  document.getElementById("ingredientRows").innerHTML = "";
  state.pendingRecipePhoto = null;

  if (recipeId) {
    const r = state.recipes.find(x => x.id === recipeId);
    document.getElementById("recipeModalTitle").textContent = "Edit recipe";
    document.getElementById("recipeName").value = r.name;
    document.getElementById("recipeServings").value = r.servings;
    document.getElementById("recipeCalories").value = r.calories ?? "";
    document.getElementById("recipeCarbs").value = r.carbs_g;
    document.getElementById("recipeFat").value = r.fat_g;
    document.getElementById("recipeProtein").value = r.protein_g;
    document.getElementById("recipeNotes").value = r.notes || "";
    r.ingredients.forEach(addIngredientRow);
    renderRecipePhotoPreview(r.photo_path);
  } else {
    document.getElementById("recipeModalTitle").textContent = "Add recipe";
    document.getElementById("recipeName").value = "";
    document.getElementById("recipeServings").value = 4;
    document.getElementById("recipeCalories").value = "";
    document.getElementById("recipeCarbs").value = 0;
    document.getElementById("recipeFat").value = 0;
    document.getElementById("recipeProtein").value = 0;
    document.getElementById("recipeNotes").value = "";
    addIngredientRow({});
    renderRecipePhotoPreview(null);
  }
  openModal("recipeModal");
}

async function handleRecipePhotoSelected(file) {
  if (!file) return;
  const id = document.getElementById("recipeId").value;
  if (id) {
    try {
      const updated = await apiUpload(`/api/recipes/${id}/photo`, file);
      await loadRecipes();
      renderRecipePhotoPreview(updated.photo_path);
      toast("Photo uploaded");
    } catch (e) {
      toast(e.message, true);
    }
  } else {
    state.pendingRecipePhoto = file;
    renderRecipePhotoPreview(URL.createObjectURL(file));
  }
}

async function saveRecipe() {
  const name = document.getElementById("recipeName").value.trim();
  if (!name) { toast("Recipe needs a name", true); return; }

  const ingredients = Array.from(document.querySelectorAll("#ingredientRows .ingredient-row"))
    .map(row => ({
      name: row.querySelector(".ing-name").value.trim(),
      quantity: parseFloat(row.querySelector(".ing-qty").value) || 0,
      unit: row.querySelector(".ing-unit").value.trim(),
      category: row.querySelector(".ing-category").value,
    }))
    .filter(i => i.name);

  const payload = {
    name,
    servings: parseInt(document.getElementById("recipeServings").value, 10) || 1,
    calories: document.getElementById("recipeCalories").value === "" ? null : parseFloat(document.getElementById("recipeCalories").value),
    carbs_g: parseFloat(document.getElementById("recipeCarbs").value) || 0,
    fat_g: parseFloat(document.getElementById("recipeFat").value) || 0,
    protein_g: parseFloat(document.getElementById("recipeProtein").value) || 0,
    notes: document.getElementById("recipeNotes").value.trim(),
    ingredients,
  };

  const id = document.getElementById("recipeId").value;
  try {
    let saved;
    if (id) {
      saved = await api(`/api/recipes/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      toast("Recipe updated");
    } else {
      saved = await api("/api/recipes", { method: "POST", body: JSON.stringify(payload) });
      toast("Recipe added");
    }
    if (state.pendingRecipePhoto) {
      await apiUpload(`/api/recipes/${saved.id}/photo`, state.pendingRecipePhoto);
      state.pendingRecipePhoto = null;
    }
    closeModal("recipeModal");
    await loadRecipes();
  } catch (e) {
    toast(e.message, true);
  }
}

async function deleteRecipe(id) {
  if (!confirm("Delete this recipe?")) return;
  try {
    await api(`/api/recipes/${id}`, { method: "DELETE" });
    delete state.planSelections[id];
    toast("Recipe deleted");
    await loadRecipes();
  } catch (e) {
    toast(e.message, true);
  }
}

// ── Macro / calorie plan ─────────────────────────────────────────────────

async function loadMacroPlan() {
  state.macroPlan = await api("/api/macro-plan");
  renderMacroPlan();
}

function renderMacroPlan() {
  const mp = state.macroPlan;
  if (!mp) return;

  document.getElementById("macroCalories").value = mp.target_calories ?? "";
  document.getElementById("macroCarbs").value = mp.target_carbs_g ?? 0;
  document.getElementById("macroFat").value = mp.target_fat_g ?? 0;
  document.getElementById("macroProtein").value = mp.target_protein_g ?? 0;
  document.getElementById("macroNotes").value = mp.notes || "";

  const m = mp.macros;
  const summary = document.getElementById("macroSummary");
  if (m.calories > 0) {
    summary.innerHTML = `
      <span class="macro-chip">${m.calories} kcal target</span>
      <span class="macro-chip macro-carb">Carbs ${m.carb_pct}%</span>
      <span class="macro-chip macro-fat">Fat ${m.fat_pct}%</span>
      <span class="macro-chip macro-protein">Protein ${m.protein_pct}%</span>
      ${m.is_high_carb_low_fat ? '<span class="badge badge-hclf">HCLF</span>' : ""}
    `;
  } else {
    summary.innerHTML = "";
  }

  const fileContainer = document.getElementById("macroFilePreview");
  document.getElementById("macroFileInput").value = "";
  if (mp.file_path) {
    const isPdf = mp.file_path.toLowerCase().endsWith(".pdf");
    fileContainer.innerHTML = `
      <div class="photo-preview-wrap">
        ${isPdf
          ? `<a href="${mp.file_path}" target="_blank" rel="noopener" class="pdf-link">📄 ${escapeHtml(mp.file_name || "plan.pdf")}</a>`
          : `<img src="${mp.file_path}" alt="Macro plan" class="photo-preview">`}
        <button type="button" class="btn btn-small btn-danger" id="btnRemoveMacroFile">Remove file</button>
      </div>
    `;
    document.getElementById("btnRemoveMacroFile").addEventListener("click", async () => {
      try {
        state.macroPlan = await api("/api/macro-plan/file", { method: "DELETE" });
        renderMacroPlan();
        toast("File removed");
      } catch (e) {
        toast(e.message, true);
      }
    });
  } else {
    fileContainer.innerHTML = `<p class="muted small">No file uploaded yet.</p>`;
  }
}

async function saveMacroPlanTargets() {
  const payload = {
    target_calories: document.getElementById("macroCalories").value === "" ? null : parseFloat(document.getElementById("macroCalories").value),
    target_carbs_g: parseFloat(document.getElementById("macroCarbs").value) || 0,
    target_fat_g: parseFloat(document.getElementById("macroFat").value) || 0,
    target_protein_g: parseFloat(document.getElementById("macroProtein").value) || 0,
    notes: document.getElementById("macroNotes").value.trim(),
  };
  try {
    state.macroPlan = await api("/api/macro-plan", { method: "PUT", body: JSON.stringify(payload) });
    renderMacroPlan();
    toast("Targets saved");
  } catch (e) {
    toast(e.message, true);
  }
}

async function handleMacroFileSelected(file) {
  if (!file) return;
  try {
    state.macroPlan = await apiUpload("/api/macro-plan/file", file);
    renderMacroPlan();
    toast("File uploaded");
  } catch (e) {
    toast(e.message, true);
  }
}

// ── Staples ───────────────────────────────────────────────────────────────

async function loadStaples() {
  state.staples = await api("/api/staples");
  renderStaples();
}

function renderStaples() {
  const container = document.getElementById("stapleList");
  if (state.staples.length === 0) {
    container.innerHTML = `<p class="empty-state">No regular items yet — add the things you always need.</p>`;
    return;
  }
  container.innerHTML = state.staples.map(s => `
    <div class="staple-row">
      <div>
        <strong>${escapeHtml(s.name)}</strong>
        <span class="muted small">${s.quantity} ${escapeHtml(s.unit || "")} · ${escapeHtml(s.category)}</span>
      </div>
      <div class="card-actions">
        <button class="btn btn-small" data-edit-staple="${s.id}">Edit</button>
        <button class="btn btn-small btn-danger" data-delete-staple="${s.id}">Delete</button>
      </div>
    </div>
  `).join("");

  container.querySelectorAll("[data-edit-staple]").forEach(btn => {
    btn.addEventListener("click", () => openStapleModal(Number(btn.dataset.editStaple)));
  });
  container.querySelectorAll("[data-delete-staple]").forEach(btn => {
    btn.addEventListener("click", () => deleteStaple(Number(btn.dataset.deleteStaple)));
  });
}

function populateCategorySelect() {
  document.getElementById("stapleCategory").innerHTML = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join("");
}

function openStapleModal(stapleId = null) {
  document.getElementById("stapleId").value = stapleId || "";
  if (stapleId) {
    const s = state.staples.find(x => x.id === stapleId);
    document.getElementById("stapleModalTitle").textContent = "Edit item";
    document.getElementById("stapleName").value = s.name;
    document.getElementById("stapleQuantity").value = s.quantity;
    document.getElementById("stapleUnit").value = s.unit || "";
    document.getElementById("stapleCategory").value = s.category;
  } else {
    document.getElementById("stapleModalTitle").textContent = "Add regular item";
    document.getElementById("stapleName").value = "";
    document.getElementById("stapleQuantity").value = 1;
    document.getElementById("stapleUnit").value = "";
    document.getElementById("stapleCategory").value = "Other";
  }
  openModal("stapleModal");
}

async function saveStaple() {
  const name = document.getElementById("stapleName").value.trim();
  if (!name) { toast("Item needs a name", true); return; }
  const payload = {
    name,
    quantity: parseFloat(document.getElementById("stapleQuantity").value) || 0,
    unit: document.getElementById("stapleUnit").value.trim(),
    category: document.getElementById("stapleCategory").value,
  };
  const id = document.getElementById("stapleId").value;
  try {
    if (id) {
      await api(`/api/staples/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      toast("Item updated");
    } else {
      await api("/api/staples", { method: "POST", body: JSON.stringify(payload) });
      toast("Item added");
    }
    closeModal("stapleModal");
    await loadStaples();
  } catch (e) {
    toast(e.message, true);
  }
}

async function deleteStaple(id) {
  if (!confirm("Remove this regular item?")) return;
  try {
    await api(`/api/staples/${id}`, { method: "DELETE" });
    toast("Item removed");
    await loadStaples();
  } catch (e) {
    toast(e.message, true);
  }
}

// ── Plan builder ──────────────────────────────────────────────────────────

function toggleHclfThresholds() {
  const on = document.getElementById("planHclf").checked;
  document.getElementById("hclfThresholds").style.display = on ? "grid" : "none";
}

async function suggestRecipes() {
  const hclf = document.getElementById("planHclf").checked;
  const params = new URLSearchParams();
  if (hclf) {
    params.set("max_fat_pct", document.getElementById("maxFatPct").value || 20);
    params.set("min_carb_pct", document.getElementById("minCarbPct").value || 55);
  }
  try {
    state.suggestions = await api(`/api/recipes/suggest?${params.toString()}`);
    renderSuggestions();
  } catch (e) {
    toast(e.message, true);
  }
}

function renderSuggestions() {
  const container = document.getElementById("suggestList");
  if (state.suggestions.length === 0) {
    container.innerHTML = `<p class="empty-state">No recipes match — add more recipes or relax the filter.</p>`;
    return;
  }
  container.innerHTML = state.suggestions.map(r => `
    <div class="suggest-row">
      <label class="checkbox-label suggest-check">
        <input type="checkbox" class="suggest-select" data-id="${r.id}" ${state.planSelections[r.id] ? "checked" : ""}>
        <span>${escapeHtml(r.name)}</span>
        ${r.macros.is_high_carb_low_fat ? '<span class="badge badge-hclf">HCLF</span>' : ""}
        <span class="muted small">C ${r.macros.carb_pct}% / F ${r.macros.fat_pct}% / P ${r.macros.protein_pct}%</span>
      </label>
      <label class="nights-input">
        nights
        <input type="number" class="suggest-nights" data-id="${r.id}" min="1" value="${state.planSelections[r.id] || 1}" ${state.planSelections[r.id] ? "" : "disabled"}>
      </label>
    </div>
  `).join("");

  container.querySelectorAll(".suggest-select").forEach(cb => {
    cb.addEventListener("change", () => {
      const id = Number(cb.dataset.id);
      const nightsInput = container.querySelector(`.suggest-nights[data-id="${id}"]`);
      if (cb.checked) {
        state.planSelections[id] = parseInt(nightsInput.value, 10) || 1;
        nightsInput.disabled = false;
      } else {
        delete state.planSelections[id];
        nightsInput.disabled = true;
      }
      renderPlanEntries();
    });
  });
  container.querySelectorAll(".suggest-nights").forEach(inp => {
    inp.addEventListener("input", () => {
      const id = Number(inp.dataset.id);
      if (state.planSelections[id] !== undefined) {
        state.planSelections[id] = parseInt(inp.value, 10) || 1;
        renderPlanEntries();
      }
    });
  });
}

function renderPlanEntries() {
  const container = document.getElementById("planEntries");
  const ids = Object.keys(state.planSelections);
  const days = parseInt(document.getElementById("planDays").value, 10) || 0;

  if (ids.length === 0) {
    container.innerHTML = `<p class="empty-state">No meals selected yet.</p>`;
  } else {
    container.innerHTML = ids.map(id => {
      const recipe = state.recipes.find(r => r.id === Number(id)) || state.suggestions.find(r => r.id === Number(id));
      const nights = state.planSelections[id];
      return `<div class="plan-entry-row">
        <span>${recipe ? escapeHtml(recipe.name) : `Recipe #${id}`}</span>
        <span class="muted small">${nights} night${nights === 1 ? "" : "s"}</span>
      </div>`;
    }).join("");
  }

  const covered = Object.values(state.planSelections).reduce((a, b) => a + b, 0);
  const progressEl = document.getElementById("nightsProgress");
  progressEl.textContent = `${covered} / ${days} nights covered`;
  progressEl.classList.toggle("progress-ok", covered >= days && days > 0);
}

async function generatePlan() {
  const days = parseInt(document.getElementById("planDays").value, 10);
  const people = parseInt(document.getElementById("planPeople").value, 10);
  const label = document.getElementById("planLabel").value.trim();
  const entries = Object.entries(state.planSelections).map(([recipe_id, nights]) => ({
    recipe_id: Number(recipe_id), nights,
  }));

  if (entries.length === 0) { toast("Select at least one recipe first", true); return; }
  if (!days || !people) { toast("Set days and people", true); return; }

  try {
    const plan = await api("/api/plans", {
      method: "POST",
      body: JSON.stringify({ days, people, label, entries }),
    });
    toast("Plan created");
    state.planSelections = {};
    document.getElementById("planLabel").value = "";
    renderSuggestions();
    renderPlanEntries();
    await loadShoppingList(plan.id);
    await loadPlanHistory();
    switchTab("shopping");
  } catch (e) {
    toast(e.message, true);
  }
}

// ── Shopping list ─────────────────────────────────────────────────────────

async function loadShoppingList(planId) {
  try {
    const result = await api(`/api/plans/${planId}/shopping-list`);
    state.currentShoppingList = result;
    state.checkedItems = loadCheckedState(planId);
    renderShoppingList();
  } catch (e) {
    toast(e.message, true);
  }
}

function checkedStorageKey(planId) { return `mealplanner_checked_${planId}`; }
function loadCheckedState(planId) {
  try { return JSON.parse(localStorage.getItem(checkedStorageKey(planId))) || {}; }
  catch (_) { return {}; }
}
function saveCheckedState(planId) {
  localStorage.setItem(checkedStorageKey(planId), JSON.stringify(state.checkedItems));
}

function renderShoppingList() {
  const meta = document.getElementById("shoppingMeta");
  const container = document.getElementById("shoppingItems");
  const data = state.currentShoppingList;

  if (!data) {
    meta.textContent = "";
    container.innerHTML = `<p class="empty-state">Generate a plan to see your shopping list here.</p>`;
    return;
  }

  const plan = data.plan;
  meta.textContent = `${plan.label ? plan.label + " · " : ""}${plan.days} days · ${plan.people} people · ${plan.nights_covered} nights covered`;

  const grouped = {};
  data.items.forEach(item => {
    grouped[item.category] = grouped[item.category] || [];
    grouped[item.category].push(item);
  });

  container.innerHTML = CATEGORIES.filter(c => grouped[c]).map(cat => `
    <div class="shopping-category">
      <h4>${cat}</h4>
      ${grouped[cat].map(item => {
        const key = `${item.name}|${item.unit}`;
        const checked = !!state.checkedItems[key];
        return `
        <div class="shopping-item ${checked ? "checked" : ""}">
          <label class="checkbox-label">
            <input type="checkbox" class="shopping-check" data-key="${escapeAttr(key)}" ${checked ? "checked" : ""}>
            <span>${escapeHtml(item.name)}${item.quantity ? ` — ${item.quantity} ${escapeHtml(item.unit || "")}` : ""}</span>
          </label>
          ${item.source === "staple" ? '<span class="badge badge-staple">regular</span>' : ""}
          <a class="tesco-link" href="${item.tesco_search_url}" target="_blank" rel="noopener">Search on Tesco ↗</a>
        </div>`;
      }).join("")}
    </div>
  `).join("");

  container.querySelectorAll(".shopping-check").forEach(cb => {
    cb.addEventListener("change", () => {
      state.checkedItems[cb.dataset.key] = cb.checked;
      cb.closest(".shopping-item").classList.toggle("checked", cb.checked);
      saveCheckedState(data.plan.id);
    });
  });
}

function copyShoppingList() {
  const data = state.currentShoppingList;
  if (!data) { toast("Nothing to copy yet", true); return; }
  const lines = [`Shopping list${data.plan.label ? " — " + data.plan.label : ""}`, ""];
  const grouped = {};
  data.items.forEach(item => {
    grouped[item.category] = grouped[item.category] || [];
    grouped[item.category].push(item);
  });
  CATEGORIES.filter(c => grouped[c]).forEach(cat => {
    lines.push(cat.toUpperCase());
    grouped[cat].forEach(item => {
      lines.push(`- ${item.name}${item.quantity ? ` (${item.quantity} ${item.unit || ""})` : ""}`);
    });
    lines.push("");
  });
  const text = lines.join("\n");
  navigator.clipboard.writeText(text).then(
    () => toast("Shopping list copied"),
    () => toast("Couldn't copy — select and copy manually", true)
  );
}

async function loadPlanHistory() {
  const plans = await api("/api/plans");
  const container = document.getElementById("planHistory");
  if (plans.length === 0) {
    container.innerHTML = `<p class="empty-state">No plans yet.</p>`;
    return;
  }
  container.innerHTML = plans.map(p => `
    <div class="history-row">
      <div>
        <strong>${escapeHtml(p.label || `Plan #${p.id}`)}</strong>
        <span class="muted small">${p.days} days · ${p.people} people · ${new Date(p.created_at).toLocaleDateString()}</span>
      </div>
      <div class="card-actions">
        <button class="btn btn-small" data-view-plan="${p.id}">View</button>
        <button class="btn btn-small btn-danger" data-delete-plan="${p.id}">Delete</button>
      </div>
    </div>
  `).join("");

  container.querySelectorAll("[data-view-plan]").forEach(btn => {
    btn.addEventListener("click", () => loadShoppingList(Number(btn.dataset.viewPlan)));
  });
  container.querySelectorAll("[data-delete-plan]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this plan?")) return;
      await api(`/api/plans/${btn.dataset.deletePlan}`, { method: "DELETE" });
      toast("Plan deleted");
      await loadPlanHistory();
    });
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

// ── Init ──────────────────────────────────────────────────────────────────

async function init() {
  initTabs();
  initModals();
  populateCategorySelect();

  document.getElementById("btnAddRecipe").addEventListener("click", () => openRecipeModal());
  document.getElementById("btnSaveRecipe").addEventListener("click", saveRecipe);
  document.getElementById("btnAddIngredientRow").addEventListener("click", () => addIngredientRow({}));
  document.getElementById("recipePhotoInput").addEventListener("change", e => handleRecipePhotoSelected(e.target.files[0]));

  document.getElementById("btnSaveMacroPlan").addEventListener("click", saveMacroPlanTargets);
  document.getElementById("macroFileInput").addEventListener("change", e => handleMacroFileSelected(e.target.files[0]));

  document.getElementById("btnAddStaple").addEventListener("click", () => openStapleModal());
  document.getElementById("btnSaveStaple").addEventListener("click", saveStaple);

  document.getElementById("planHclf").addEventListener("change", toggleHclfThresholds);
  document.getElementById("planDays").addEventListener("input", renderPlanEntries);
  document.getElementById("btnSuggest").addEventListener("click", suggestRecipes);
  document.getElementById("btnGeneratePlan").addEventListener("click", generatePlan);

  document.getElementById("btnCopyList").addEventListener("click", copyShoppingList);
  document.getElementById("btnOpenTesco").addEventListener("click", () => {
    window.open("https://www.tesco.com/groceries/en-GB/", "_blank", "noopener");
  });

  toggleHclfThresholds();
  await Promise.all([loadRecipes(), loadStaples(), loadPlanHistory(), loadMacroPlan()]);
  renderPlanEntries();
}

document.addEventListener("DOMContentLoaded", init);
