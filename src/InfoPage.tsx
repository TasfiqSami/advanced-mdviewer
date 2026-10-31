import { ArrowRight, BookOpen, ShieldCheck, Sparkles } from "lucide-react";
import type { AppPage } from "./pages";

const pageCopy: Record<Exclude<AppPage, "workspace" | "converter">, {
  eyebrow: string;
  title: string;
  intro: string;
}> = {
  guide: {
    eyebrow: "WORKSPACE GUIDE",
    title: "A clear path through your notes.",
    intro: "Find your way around the library, keep notes organized, and make the writing space your own.",
  },
  "markdown-guide": {
    eyebrow: "MARKDOWN FIELD GUIDE",
    title: "Write with Markdown.",
    intro: "A practical reference for the formatting syntax supported by the live preview.",
  },
  privacy: {
    eyebrow: "PRIVACY",
    title: "Your notes stay yours.",
    intro: "This draft describes how the self-hosted Syxlor Markdown Viewer handles workspace data. Review and adapt it for your deployment before publishing.",
  },
  terms: {
    eyebrow: "TERMS",
    title: "Terms of use.",
    intro: "These general terms are a starting point for the self-hosted workspace and should be reviewed for your specific deployment.",
  },
};

function GuidePage() {
  return (
    <>
      <section className="info-card">
        <h2><BookOpen size={18} /> Your library</h2>
        <p>All documents appear in the library. Use search to find a note by title or content, or narrow the list with Favorites, Recently opened, Trash, folders, or tags. The card action moves a document to Trash; items there can be restored or permanently removed.</p>
      </section>
      <section className="info-card">
        <h2><Sparkles size={18} /> Writing and preview</h2>
        <p>Open a document to edit Markdown on the left and see its rendered result in Live Preview. On smaller screens, use the Edit/Preview toggle. The formatting toolbar inserts common Markdown patterns. Changes save automatically; the status indicator shows when a save is in progress or needs attention.</p>
      </section>
      <section className="info-card">
        <h2><ArrowRight size={18} /> Import, export, and organize</h2>
        <p>Import a Markdown note from the library, or use Converter to turn a supported file into Markdown and download it as another format. Add folders, tags, favorites, and pins to keep larger collections easy to navigate. Export a document as Markdown, plain text, HTML, PDF, DOCX, or a ZIP containing its Markdown file.</p>
      </section>
      <section className="info-card">
        <h2><ShieldCheck size={18} /> Privacy and recovery</h2>
        <p>Access is restricted to the workspace owner. Use a strong owner password and protect the server environment and its backups. Deleted notes first go to Trash. If a browser draft is available after a save problem, the workspace offers to restore it when the note is reopened.</p>
      </section>
    </>
  );
}

function MarkdownGuidePage() {
  return (
    <>
      <section className="info-card">
        <h2>Headings and emphasis</h2>
        <pre><code>{`# Main heading
## Section

**Bold text** and *italic text*
~~Strikethrough~~`}</code></pre>
        <p>Use one to six <code>#</code> characters for heading levels. Leave a blank line between paragraphs for predictable rendering.</p>
      </section>
      <section className="info-card">
        <h2>Lists and task checkboxes</h2>
        <pre><code>{`- First item
- Second item
  - Nested item

1. First step
2. Next step

- [ ] To do
- [x] Complete`}</code></pre>
      </section>
      <section className="info-card">
        <h2>Links, images, and quotes</h2>
        <pre><code>{`[Link text](https://example.com)
![Description](image-url)

> A useful quote or callout.`}</code></pre>
        <p>Use the image button in the editor toolbar to upload and insert an image. External links open in a new tab.</p>
      </section>
      <section className="info-card">
        <h2>Code, tables, and math</h2>
        <pre><code>{`\`inline code\`

\`\`\`js
const answer = 42;
\`\`\`

| Name | Value |
| --- | --- |
| Answer | 42 |

$E = mc^2$`}</code></pre>
        <p>Fenced code blocks support syntax highlighting and copy. Tables, task lists, and common math expressions are supported in the preview.</p>
      </section>
    </>
  );
}

function PrivacyPage() {
  return (
    <>
      <section className="info-card">
        <h2>Data handled by the workspace</h2>
        <p>Documents, revisions, folders, tags, settings, and uploaded attachments are stored by the server running this application. In the standard setup, the server uses a local SQLite database and a storage directory. The person or organization operating the server controls its location, backups, access, and retention.</p>
      </section>
      <section className="info-card">
        <h2>Authentication and browser storage</h2>
        <p>The workspace uses an owner sign-in and a session cookie to keep you signed in. A CSRF token is used for protected changes. Theme and sound preferences, along with a recovery draft when needed, may be saved in this browser's local storage. Clearing browser data removes those local preferences and drafts and may sign you out.</p>
      </section>
      <section className="info-card">
        <h2>Sharing, analytics, and retention</h2>
        <p>Documents are not published by the workspace itself. Anyone with administrative access to the server or its backups may be able to access stored data. The application records limited operational events for the owner management view. This draft makes no claim about analytics, hosting-provider logs, or other services that a deployment may add; check the configuration and hosting provider's own notices.</p>
        <p>You can move a note to Trash, restore it, or permanently delete it from Trash. Server operators should maintain appropriate backups and protect credentials, recovery keys, and signing secrets.</p>
      </section>
      <section className="info-card">
        <h2>Contact and updates</h2>
        <p>For a self-hosted installation, contact the person or organization that operates the server with privacy questions or requests. The operator should replace this draft with accurate deployment-specific details and update it when data practices change.</p>
      </section>
      <p className="legal-draft-note">Draft notice — not legal advice. Confirm this page against the actual hosting, logging, backup, and analytics configuration before relying on it.</p>
    </>
  );
}

function TermsPage() {
  return (
    <>
      <section className="info-card">
        <h2>Using the workspace</h2>
        <p>Use the workspace only when authorized by its operator. Keep your sign-in details and recovery information private, and do not attempt to bypass access controls or disrupt the service. The operator may restrict access to protect the workspace or comply with applicable requirements.</p>
      </section>
      <section className="info-card">
        <h2>Your content and backups</h2>
        <p>You retain responsibility for the content you create, import, and upload, including having the rights and permissions needed to use it. Keep independent backups of important work. The operator controls the server, data retention, and availability; deleted or unsaved content may not be recoverable.</p>
      </section>
      <section className="info-card">
        <h2>Availability and third-party material</h2>
        <p>The workspace is provided as available, without a promise of uninterrupted operation or error-free conversion. Converted files may not preserve every feature or layout of the source. External links and services are outside the workspace operator's control and are used at your discretion.</p>
      </section>
      <section className="info-card">
        <h2>Changes and contact</h2>
        <p>The operator may update these terms or change the service. Continued use after an update is subject to the revised terms to the extent allowed by applicable law. Contact the server operator with questions about these terms.</p>
      </section>
      <p className="legal-draft-note">Draft terms — not legal advice. Have these terms reviewed and adapt them to the operator, jurisdiction, and deployment before publishing.</p>
    </>
  );
}

export default function InfoPage({ page }: { page: Exclude<AppPage, "workspace" | "converter"> }) {
  const copy = pageCopy[page];
  return (
    <main className="info-page">
      <div className="info-page-heading">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p>{copy.intro}</p>
      </div>
      {page === "guide" && <GuidePage />}
      {page === "markdown-guide" && <MarkdownGuidePage />}
      {page === "privacy" && <PrivacyPage />}
      {page === "terms" && <TermsPage />}
    </main>
  );
}
