# ESCO Skill Description Lookup

## Purpose

Find the ESCO skill concept that best matches a user-provided skill name and its context, then return the official ESCO description for that concept.

The context may come from a document, job profile, task description, industry description, user text, or other supplied information.

Use the context only to identify which ESCO skill concept is the best match. Do not use the context to rewrite, extend, summarize, or generate the final ESCO description.

## Inputs

The input may contain:

- `skillName`: the skill to search for.
- `context`: optional information that helps determine what the skill means in this specific situation.
- `language`: requested language for the ESCO description.

If `language` is not provided, use:

```text
en
```

Example:

```json
{
  "skillName": "project management",
  "context": "The employee plans technical projects, coordinates resources, manages deadlines and requirements, and responds to unexpected project risks.",
  "language": "en"
}
```

## Step 1: Search ESCO

URL-encode the `skillName` and make a GET request to:

```text
https://ec.europa.eu/esco/api/search?text={encodedSkillName}&type=skill&language={language}&selectedVersion=v1.2.0
```

Example for `project management`:

```text
GET https://ec.europa.eu/esco/api/search?text=project%20management&type=skill&language=en&selectedVersion=v1.2.0
```

Do not invent ESCO concepts or URLs. Use only concepts returned by the ESCO API.

## Step 2: Read the Search Results

Read:

```text
_embedded.results
```

Example search response structure:

```json
{
  "total": 1741,
  "text": "project management",
  "language": "en",
  "type": [
    "skill"
  ],
  "_embedded": {
    "results": [
      {
        "className": "Skill",
        "uri": "http://data.europa.eu/esco/skill/7111b95d-0ce3-441a-9d92-4c75d05c4388",
        "searchHit": "project management",
        "title": "project management",
        "_links": {
          "self": {
            "href": "https://ec.europa.eu/esco/api/resource/skill?uri=http://data.europa.eu/esco/skill/7111b95d-0ce3-441a-9d92-4c75d05c4388&language=en",
            "uri": "http://data.europa.eu/esco/skill/7111b95d-0ce3-441a-9d92-4c75d05c4388",
            "title": "project management"
          }
        }
      },
      {
        "className": "Skill",
        "uri": "http://data.europa.eu/esco/skill/4ca91852-c534-4b98-ab1c-59a126534c88",
        "searchHit": "project management",
        "title": "project commissioning",
        "_links": {
          "self": {
            "href": "https://ec.europa.eu/esco/api/resource/skill?uri=http://data.europa.eu/esco/skill/4ca91852-c534-4b98-ab1c-59a126534c88&language=en",
            "uri": "http://data.europa.eu/esco/skill/4ca91852-c534-4b98-ab1c-59a126534c88",
            "title": "project commissioning"
          }
        }
      },
      {
        "className": "Skill",
        "title": "project management principles",
        "_links": {
          "self": {
            "href": "https://ec.europa.eu/esco/api/resource/skill?uri=http://data.europa.eu/esco/skill/237db40b-4600-47c0-837f-4a2c4f3014ab&language=en",
            "uri": "http://data.europa.eu/esco/skill/237db40b-4600-47c0-837f-4a2c4f3014ab",
            "title": "project management principles"
          }
        }
      }
    ]
  }
}
```

## Step 3: Filter Valid Skill Results

Evaluate every item returned in:

```text
_embedded.results
```

Only consider items where:

```text
className
```

equals `Skill`, ignoring capitalization.

For example, accept:

```text
Skill
skill
SKILL
```

Ignore results representing other ESCO concept classes.

## Step 4: Select the Most Relevant ESCO Skill

Compare every valid result against:

1. `skillName`
2. `context`

Use primarily:

```text
title
searchHit
preferredLabel
```

when those fields are available.

The skill name establishes the target concept. The context is used to resolve ambiguity between multiple related ESCO concepts.

### Selection priority

Prefer the result whose meaning most closely represents the skill described by both the skill name and context.

Give strong preference to an exact or near-exact title match when it is compatible with the context.

For example, a search for:

```text
project management
```

may return concepts such as:

```text
project management
project management principles
Agile project management
lean project management
ICT project management methodologies
perform project management
project commissioning
```

If the context describes general planning, resources, requirements, deadlines, and project coordination, `project management` is more relevant than `project commissioning`.

If the context explicitly describes Agile practices, iterations, backlogs, or Agile project delivery, `Agile project management` may be more relevant.

If the context describes carrying out project-management activities as an operational capability rather than knowledge about project management, `perform project management` may be more relevant.

Do not choose a result merely because it contains the same words as `skillName`. Evaluate the meaning of the complete title against the supplied context.

Do not invent a match that is not present in the ESCO results.

## Step 5: Get the Selected Skill

After selecting the most relevant result, read:

```text
_links.self.href
```

Example:

```json
{
  "_links": {
    "self": {
      "href": "https://ec.europa.eu/esco/api/resource/skill?uri=http://data.europa.eu/esco/skill/7111b95d-0ce3-441a-9d92-4c75d05c4388&language=en",
      "uri": "http://data.europa.eu/esco/skill/7111b95d-0ce3-441a-9d92-4c75d05c4388",
      "title": "project management"
    }
  }
}
```

Make a GET request directly to the selected `href`.

Example:

```text
GET https://ec.europa.eu/esco/api/resource/skill?uri=http://data.europa.eu/esco/skill/7111b95d-0ce3-441a-9d92-4c75d05c4388&language=en
```

Use the requested language in the request.

## Step 6: Extract the Official Description

The skill resource contains a `description` object.

Example:

```json
{
  "className": "Skill",
  "uri": "http://data.europa.eu/esco/skill/7111b95d-0ce3-441a-9d92-4c75d05c4388",
  "title": "project management",
  "description": {
    "de": {
      "literal": "Verständnis der Projektleitung und der Aktivitäten, die diesen Bereich umfassen. Kenntnis der für die Projektleitung relevanten Variablen wie Zeit, Ressourcen, Anforderungen, Fristen und Reaktionen auf unerwartete Ereignisse.",
      "mimetype": "plain/text"
    },
    "en": {
      "literal": "Understand project management and the activities which comprise this area. Know the variables implied in project management such as time, resources, requirements, deadlines, and responding to unexpected events.",
      "mimetype": "plain/text"
    }
  }
}
```

Read:

```text
description[language].literal
```

For:

```json
{
  "language": "en"
}
```

return:

```text
description.en.literal
```

For:

```json
{
  "language": "de"
}
```

return:

```text
description.de.literal
```

## Language Fallback

If the requested language does not exist inside `description`:

1. Try `description.en.literal`.
2. If English is also unavailable, use another available description only if necessary.
3. Do not translate the ESCO description yourself unless the user explicitly requests translation.

## Final Response

Return the official ESCO description.

Do not create a new skill description.

Do not rewrite the ESCO description.

Do not merge the description with information from the supplied context.

Do not summarize it.

Do not add information from general knowledge.

Default output:

```text
{description[language].literal}
```

For example:

```text
Understand project management and the activities which comprise this area. Know the variables implied in project management such as time, resources, requirements, deadlines, and responding to unexpected events.
```

## Important Rules

- The ESCO API is the source of truth for the final description.
- The supplied context is used only for concept disambiguation.
- Evaluate all valid items in `_embedded.results` before selecting a concept.
- Only accept results whose `className` represents `Skill`.
- Prefer exact semantic correspondence over simple keyword overlap.
- Never invent an ESCO URI, title, description, or API response.
- Always follow `_links.self.href` from the selected search result.
- Return `description[language].literal` from the selected resource.
- Default to `en` when no language is provided.
- Preserve the official ESCO description exactly as returned.