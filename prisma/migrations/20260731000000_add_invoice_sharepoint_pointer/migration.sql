-- Archive finalised tax-invoice PDFs to SharePoint (TASK-068).
--
-- The app is the identity/record master but stores only pointers to
-- files in SharePoint, never binary content (A3). These two columns
-- hold the browser-openable webUrl and the Graph DriveItem id for the
-- rendered tax-invoice PDF, populated the first time an invoice is
-- finalised while Graph is configured. Both nullable so historical
-- invoices (and any finalised while Graph was unreachable) render fine
-- without a value; the finalise action retries the upload on the next
-- call until the URL is set.
ALTER TABLE "Invoice" ADD COLUMN "taxInvoiceSharepointUrl" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "taxInvoiceDriveItemId" TEXT;
