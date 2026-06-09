/**
 * Avvolge il contenuto HTML di un'email in un template grafico moderno, professionale e responsivo.
 * Utilizza tabelle e stili in linea per garantire la massima compatibilità con tutti i client email (incluso Outlook).
 */
export function wrapMailTemplate(title: string, htmlContent: string): string {
  // Riconverte blocchi di citazione in tabelle compatibili con Outlook
  let cleanedContent = htmlContent;

  if (cleanedContent.includes('<blockquote')) {
    cleanedContent = cleanedContent.replace(
      /<blockquote[^>]*style="[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/gi,
      (_match, content) => {
        const text = content.replace(/["\s\n\r]+/g, ' ').trim();
        return `
          <table border="0" cellspacing="0" cellpadding="0" style="margin: 16px 0; background-color: #fffbeb; border-left: 4px solid #f59e0b; width: 100%;">
            <tr>
              <td style="padding: 12px 16px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-style: italic; color: #b45309;">
                ${text}
              </td>
            </tr>
          </table>
        `;
      }
    );
  }

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f3f4f6; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6; width: 100%; padding: 40px 0; font-family: Arial, Helvetica, sans-serif;">
      <tr>
        <td align="center">
          <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%; background-color: #ffffff; border-radius: 16px; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); margin-bottom: 20px;">
            <!-- Accent bar solid color for Outlook + Gradient for modern clients -->
            <tr>
              <td height="6" style="height: 6px; background-color: #4f46e5; background: linear-gradient(90deg, #4f46e5 0%, #7c3aed 100%); line-height: 6px; font-size: 1px;">&nbsp;</td>
            </tr>
            <!-- Content -->
            <tr>
              <td style="padding: 32px; font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.6; color: #374151;">
                ${cleanedContent}
              </td>
            </tr>
          </table>
          
          <!-- Footer -->
          <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%; text-align: center;">
            <tr>
              <td style="padding: 10px 20px; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.5; color: #9ca3af; text-align: center;">
                Questa è una notifica automatica inviata dal sistema Pianificazione Aziendale.<br />
                Si prega di non rispondere a questo messaggio.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
