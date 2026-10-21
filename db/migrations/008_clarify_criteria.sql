-- =====================================================================
-- AI clarification criteria: what the team needs to know about a project at request time,
-- per document type (Admin → Document Types). Before submit the AI asks the requestor,
-- round after round, until the required criteria are covered. Empty list = no AI questions.
-- =====================================================================
SET NAMES utf8mb4;

-- [{key, label, hint, required}] — see ClarifyCriterion in src/lib/clarify.ts
ALTER TABLE document_types
  ADD COLUMN clarify_criteria JSON NULL AFTER approval_route;

-- {checked_at, criteria: [{key, label, required, status: covered|missing|not_applicable, note}]} — last AI check
ALTER TABLE project_requests
  ADD COLUMN ai_coverage JSON NULL AFTER ai_clarifications;

UPDATE document_types SET clarify_criteria = '[{"key":"users","label":"Users","hint":"Who will use the system, which departments, roughly how many people","required":true},{"key":"current_process","label":"Current process & problem","hint":"How the work is done today and what exactly goes wrong","required":true},{"key":"features","label":"Main features & scope","hint":"The main features / screens it must have, and what is out of scope","required":true},{"key":"key_user","label":"Key user","hint":"Who on the requestor side gives the details and tests / accepts the system (UAT)","required":true},{"key":"success","label":"Success criteria","hint":"How the requestor will know the project succeeded (measurable if possible)","required":true},{"key":"data_io","label":"Data in & reports out","hint":"What data is entered and which reports / documents must come out","required":false},{"key":"integrations","label":"Other systems","hint":"Systems or files it must connect to: ERP, Excel, machines, e-mail…","required":false},{"key":"devices","label":"Devices & place of use","hint":"PC, mobile, tablet, shop floor","required":false},{"key":"approval_flow","label":"Approval steps","hint":"Who fills in, who approves, how many steps","required":false},{"key":"permissions","label":"Permissions","hint":"Who may see or change what","required":false},{"key":"existing_data","label":"Existing data & volume","hint":"Old data to move in, and how much data per day / month","required":false},{"key":"constraints","label":"Rules & constraints","hint":"Audit / standards (IATF, ISO), personal data (PDPA), why the required date","required":false}]' WHERE clarify_criteria IS NULL;
