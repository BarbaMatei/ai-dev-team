# Interview

One question per message, in plain words, with a default in brackets when one is obvious, so the owner can answer with a word. Never ask about the tech stack, data, coding rules or UI: specsmd's project-init asks those.

1. **Name:** "What is the project called?" [the folder name]. The repository name is its lowercase form with dashes; a name other than the folder's renames nothing on disk (the work folder keeps the folder name).
2. **Purpose:** "In one or two sentences, what is it for?"
3. **Users:** "Who will use it?"
4. **Must do:** "What is the one thing those users must be able to do?"
5. **Language:** "Which language do the users read?" [English]
6. **GitHub owner:** "Which GitHub account or organization owns it?" [`gh api user --jq .login`]. Then `node "<scripts>/github.mjs" owner <login>` gives `User` or `Organization`.
7. **Visibility:** "Public or private?" [private]. Say once: on GitHub's free plan a private repository cannot protect its main branch; everything else works.

Existing repository: do not ask what it already answers. Name and owner come from `origin`, visibility from `gh repo view --json visibility`, the purpose from its README; confirm them in one message, then ask only the rest. `github.mjs owner <login>` still gives `ownerType`.

The answers file keeps `purpose`, `users` and `mustDo` for first-feature.md; no rendered file uses them.
