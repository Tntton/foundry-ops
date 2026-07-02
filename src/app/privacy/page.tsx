import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy · Foundry Ops',
  description:
    'How Foundry Health collects, uses, and protects information in the Foundry Ops platform, including messages sent to our WhatsApp business number.',
};

// Public route — deliberately outside the (app) route group so it is
// reachable without a session (same pattern as /healthz). Meta requires
// a publicly crawlable privacy policy URL before a WhatsApp app can be
// published to Live mode.
export const dynamic = 'force-static';

const LAST_UPDATED = '2 July 2026';

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-slate-800">
      <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
        Privacy Policy
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        Foundry Ops · Foundry Health · Last updated {LAST_UPDATED}
      </p>

      <div className="mt-8 space-y-6 leading-relaxed">
        <section>
          <h2 className="text-lg font-semibold text-slate-900">Who we are</h2>
          <p className="mt-2">
            Foundry Ops is the internal operating platform of Foundry Health, a
            healthcare strategy consultancy operating in Australia and New
            Zealand. This platform is used by Foundry Health staff and engaged
            contractors to run day-to-day operations (personnel, projects,
            timesheets, expenses, invoicing, and approvals). It is not a
            consumer product and is not intended for use by the general public.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-900">
            Information we collect
          </h2>
          <p className="mt-2">We collect and process:</p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>
              Identity and contact details of staff and contractors (name,
              email, phone number, role).
            </li>
            <li>
              Operational records created in the course of business —
              timesheets, expenses, project data, invoices, and approvals.
            </li>
            <li>
              Messages, photos, and documents sent to our WhatsApp business
              number, together with the sending phone number and message
              metadata, where you use WhatsApp to interact with the platform
              (for example, to log an expense by sending a receipt photo).
            </li>
            <li>
              Standard technical logs (timestamps, IP address, user agent) kept
              for security and audit purposes.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-900">
            How we use information
          </h2>
          <p className="mt-2">
            We use this information solely to operate Foundry Health&apos;s
            business — to record and process the action you request (such as
            logging a timesheet entry or an expense), to route approvals, to
            maintain an audit trail of changes, and to keep the platform secure.
            Content you send to our WhatsApp business number is processed to
            carry out the specific request it relates to. We do not use your
            information for advertising, and we do not sell it.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-900">
            WhatsApp messaging
          </h2>
          <p className="mt-2">
            Where you contact our WhatsApp business number, your messages are
            delivered to us through the WhatsApp Business Platform operated by
            Meta and are subject to WhatsApp&apos;s own terms and privacy
            practices. We only act on messages sent from phone numbers
            registered to a known member of the Foundry Health team; messages
            from unrecognised numbers are ignored. Media you send (such as
            receipt photos) is stored in Foundry Health&apos;s Microsoft 365
            environment.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-900">
            Where information is stored and who processes it
          </h2>
          <p className="mt-2">
            Platform data is hosted with our infrastructure providers (including
            Vercel and Supabase) and files are stored in Microsoft 365
            (SharePoint / OneDrive). We share information with service providers
            strictly as needed to operate the platform, including Meta
            (WhatsApp), Microsoft, Xero (accounting), and Anthropic (for
            AI-assisted processing of documents and messages, such as reading a
            receipt). These providers act as our processors and are not
            permitted to use the information for their own purposes beyond
            providing their service to us.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-900">
            Security and retention
          </h2>
          <p className="mt-2">
            We apply access controls, encryption of sensitive fields, and audit
            logging to protect information. Access is limited to authorised
            Foundry Health personnel based on their role. We retain information
            for as long as needed to run the business and to meet our legal,
            tax, and record-keeping obligations, after which it is deleted or
            de-identified.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-900">Your rights</h2>
          <p className="mt-2">
            We handle personal information in accordance with the Australian
            Privacy Principles under the Privacy Act 1988 (Cth). You may request
            access to, or correction of, the personal information we hold about
            you, or raise a privacy concern, by contacting us below.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-900">Contact</h2>
          <p className="mt-2">
            For any privacy question or request, contact Foundry Health at{' '}
            <a
              className="font-medium text-blue-600 underline"
              href="mailto:contact@foundry.health"
            >
              contact@foundry.health
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
