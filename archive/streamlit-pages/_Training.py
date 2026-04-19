"""Training — hidden page accessible from footer."""
import streamlit as st

st.set_page_config(page_title="Training | Lariat", layout="wide")
st.title("Training")

st.info("Training materials are being developed. Check back soon.")

st.subheader("ServSafe Certification")
st.markdown("""
- **Food Handler**: Required for all BOH staff within 30 days of hire
- **Manager Certification**: Required for KM and Sous positions
- **Renewal**: Every 5 years
- [ServSafe.com](https://www.servsafe.com) — official certification portal
""")

st.subheader("House Training")
st.markdown("""
- Station setup/teardown procedures → see BOH Bible
- Line check procedures → see BOH Bible
- Recipe scaling and portioning → see Recipes page
- Food safety and HACCP → see Food Safety (linked below)
""")
