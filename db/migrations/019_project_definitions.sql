-- =====================================================================
-- The requirement summary becomes the project definition: everything the team must know to build the system
-- (overview, scope, functional, data, technical, delivery — see ProjectDefinition in src/lib/definition.ts).
-- Saved summaries keep their content; the app reads the old 9-section shape into the new sections.
-- =====================================================================
RENAME TABLE project_requirement_summaries TO project_definitions;
