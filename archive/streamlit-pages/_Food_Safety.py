"""Food Safety — HACCP checklist, temp log, corrective actions, inspections."""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import streamlit as st

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
from libs.data_paths import get_data_root  # noqa: E402
from libs.st_helpers import cached_load_csv  # noqa: E402
from libs.ui_format import humanize_columns  # noqa: E402

DATA_ROOT = get_data_root()

st.set_page_config(page_title="Food Safety | Lariat", layout="wide")
st.title("Food Safety")


haccp_tab, temp_tab, corrective_tab, inspection_tab, allergen_tab, servsafe_tab = st.tabs(
    ["HACCP Checklist", "Temp Log", "Corrective Actions", "Inspections", "Allergens", "ServSafe Quick Reference"]
)

# ── HACCP checklist ──────────────────────────────────────────────────────────
with haccp_tab:
    st.subheader("HACCP Checklist Template")
    haccp = cached_load_csv(DATA_ROOT, "food_safety/haccp_checklist_template.csv")
    if haccp is not None:
        # Display meaningful columns
        display_cols = [c for c in ["ccp_id", "critical_control_point", "hazard",
                                    "critical_limit", "monitoring_procedure",
                                    "corrective_action"] if c in haccp.columns]
        st.dataframe(humanize_columns(haccp[display_cols] if display_cols else haccp), use_container_width=True)
        st.metric("Total CCPs", len(haccp[haccp["ccp_id"].notna()]) if "ccp_id" in haccp.columns else len(haccp))
    else:
        st.warning("No HACCP checklist template found.")

# ── temp log ─────────────────────────────────────────────────────────────────
with temp_tab:
    st.subheader("Daily Temperature Log Template")
    temp_log = cached_load_csv(DATA_ROOT, "food_safety/daily_temp_log_template.csv")
    if temp_log is not None:
        st.dataframe(humanize_columns(temp_log), use_container_width=True)
        st.caption("Fill in date, time, recorded_by, and temp_f for each location/shift.")
    else:
        st.warning("No temperature log template found.")

# ── corrective actions ───────────────────────────────────────────────────────
with corrective_tab:
    st.subheader("Corrective Actions Log")
    corrective = cached_load_csv(DATA_ROOT, "food_safety/corrective_actions.csv")
    if corrective is not None and len(corrective) > 0:
        st.dataframe(humanize_columns(corrective), use_container_width=True)
        if "follow_up_needed" in corrective.columns:
            needs_followup = corrective[corrective["follow_up_needed"].astype(str).str.strip().str.lower().isin(["true", "yes", "1"])]
            if not needs_followup.empty:
                st.warning(f"{len(needs_followup)} corrective action(s) need follow-up.")
    else:
        st.info("No corrective actions recorded yet.")

# ── inspection history ───────────────────────────────────────────────────────
with inspection_tab:
    st.subheader("Inspection History")
    inspections = cached_load_csv(DATA_ROOT, "food_safety/inspection_history.csv")
    if inspections is not None and len(inspections) > 0:
        st.dataframe(humanize_columns(inspections), use_container_width=True)
        if "score" in inspections.columns:
            inspections["score"] = pd.to_numeric(inspections["score"], errors="coerce")
            valid = inspections.dropna(subset=["score"])
            if not valid.empty:
                st.metric("Latest Score", f"{valid.iloc[-1]['score']}")
                st.metric("Average Score", f"{valid['score'].mean():.1f}")
    else:
        st.info("No inspection history recorded yet.")

# ── allergens ─────────────────────────────────────────────────────────────────
BIG_9 = ["milk", "eggs", "fish", "shellfish", "tree_nuts", "peanuts", "wheat", "soybeans", "sesame"]

with allergen_tab:
    st.subheader("Allergen Matrix")
    allergen_path = DATA_ROOT / "allergens" / "allergen_matrix.csv"
    if not allergen_path.exists():
        st.info("No allergen data available.")
    else:
        allergens_raw = pd.read_csv(allergen_path, dtype=str)

        # Recipe filter
        recipe_ids = sorted(allergens_raw["recipe_id"].dropna().unique()) if "recipe_id" in allergens_raw.columns else []
        selected_recipe = st.selectbox(
            "Filter by recipe",
            options=["All recipes"] + recipe_ids,
            key="allergen_recipe_filter",
        )

        df_filtered = allergens_raw.copy()
        if selected_recipe != "All recipes":
            df_filtered = df_filtered[df_filtered["recipe_id"] == selected_recipe]

        # Pivot: one row per recipe_id showing which allergens are present
        allergen_cols = [c for c in BIG_9 if c in df_filtered.columns]

        if allergen_cols:
            # Build a summary pivot: one row per recipe, columns = allergens
            def _has_allergen(series: pd.Series) -> str:
                return "Yes" if series.astype(str).str.strip().str.upper().eq("X").any() else ""

            pivot = (
                df_filtered.groupby("recipe_id")[allergen_cols]
                .agg(_has_allergen)
                .reset_index()
            )

            # Apply humanize_columns for display
            display_df = humanize_columns(pivot)

            # Conditional formatting: highlight "Yes" cells
            allergen_display_cols = [c for c in display_df.columns if c != "Recipe"]

            def _highlight_yes(val: str) -> str:
                return "background-color: #ffe0e0; color: #b00020; font-weight: bold;" if val == "Yes" else ""

            styled = display_df.style.applymap(_highlight_yes, subset=allergen_display_cols)
            st.dataframe(styled, use_container_width=True)

            # Summary metrics
            total_recipes = len(pivot)
            recipes_with_any = (pivot[allergen_cols].eq("Yes").any(axis=1)).sum()
            col1, col2 = st.columns(2)
            col1.metric("Recipes checked", total_recipes)
            col2.metric("Recipes with at least one allergen", recipes_with_any)

            # Per-allergen counts
            st.caption("**Allergen presence by recipe count:**")
            counts = {col: pivot[col].eq("Yes").sum() for col in allergen_cols}
            count_df = pd.DataFrame(
                [{"Allergen": c.replace("_", " ").title(), "Recipes Affected": n} for c, n in counts.items() if n > 0]
            )
            if not count_df.empty:
                st.dataframe(count_df, use_container_width=True, hide_index=True)
            else:
                st.success("No Big 9 allergens flagged in the current selection.")
        else:
            st.dataframe(humanize_columns(df_filtered), use_container_width=True)
            st.caption("No Big 9 allergen columns found in the matrix.")

# ── servsafe quick reference ──────────────────────────────────────────────────
with servsafe_tab:
    st.subheader("ServSafe Quick Reference")

    col_left, col_right = st.columns(2)

    with col_left:
        st.markdown(
            """
#### Safe Cooking Temperatures
| Food | Internal Temp | Notes |
|------|--------------|-------|
| Poultry (whole, ground, stuffed) | **165°F (74°C)** | Instant kill |
| Ground meats (beef, pork) | **155°F (68°C)** | — |
| Steaks / chops / roasts | **145°F (63°C)** | + 3 min rest |
| Fish / seafood | **145°F (63°C)** | + 3 min rest |
| Reheating leftovers | **165°F (74°C)** | Within 2 hours |
| Eggs (hot-held) | **155°F (68°C)** | — |
"""
        )

        st.markdown(
            """
#### Temperature Danger Zone
> **41°F – 135°F (5°C – 57°C)**

Food must **not** remain in this range for more than **4 hours total** (cumulative).
Discard anything that has been in the danger zone for 4+ hours — do not reheat.
"""
        )

        st.markdown(
            """
#### Cooling Requirements (2-stage)
| Stage | From | To | Time Allowed |
|-------|------|----|--------------|
| Stage 1 | 135°F (57°C) | 70°F (21°C) | **2 hours** |
| Stage 2 | 70°F (21°C) | 41°F (5°C) | **4 hours** |
| **Total** | | | **6 hours max** |

Use ice baths, blast chillers, or shallow pans (≤ 2" depth) to speed cooling.
"""
        )

    with col_right:
        st.markdown(
            """
#### Personal Hygiene — Handwashing
- **Duration:** minimum **20 seconds** with soap and warm running water
- **When to wash:**
  - Before handling food or putting on gloves
  - After touching face, hair, or body
  - After using the restroom
  - After handling raw protein (chicken, beef, fish, eggs)
  - Between switching tasks or food types
  - After handling garbage, chemicals, or money

#### Glove Policy
- Change gloves **between tasks** and whenever switching food types
- Change gloves after touching non-food surfaces (phone, door handle, trash)
- Gloves do **not** replace handwashing — wash hands before gloving
"""
        )

        st.markdown(
            """
#### Cross-Contamination Prevention
- **Color-coded cutting boards:**
  Red = raw beef · Yellow = raw poultry · Blue = raw fish
  Green = produce · White = dairy/deli · Purple = allergens
- **Cooler storage order** (top → bottom):
  Ready-to-eat → whole fish → whole beef → ground meats → poultry
- **Allergen prep:** use dedicated equipment; clean and sanitize between allergen and non-allergen tasks; prep allergen dishes first when possible
- **Sanitizer concentrations:**
  Quaternary ammonium (quat): **200 ppm**
  Chlorine (bleach): **50–100 ppm**
"""
        )

    st.divider()
    st.caption(
        "Reference: FDA Food Code 2022 · ServSafe Manager 7th Ed. · "
        "Always verify local health code requirements — regulations vary by jurisdiction."
    )
