/**
 * Avvolge il contenuto HTML di un'email in un template grafico moderno, professionale,
 * rigidamente centrato a 650px e 100% compatibile con tutti i client email e tutte le versioni di Outlook (Windows MSO, Web, Mac, Mobile).
 */
export function wrapMailTemplate(title: string, htmlContent: string): string {
  let cleanedContent = htmlContent;

  // Riconverte eventuali blocchi blockquote in tabelle compatibili con Outlook
  if (cleanedContent.includes('<blockquote')) {
    cleanedContent = cleanedContent.replace(
      /<blockquote[^>]*style="[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/gi,
      (_match, content) => {
        const text = content.replace(/["\s\n\r]+/g, ' ').trim();
        return `
          <table border="0" cellspacing="0" cellpadding="0" style="margin: 14px 0; background-color: #fffbeb; border-left: 4px solid #f59e0b; width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 10px 14px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-style: italic; color: #b45309; line-height: 1.5;">
                ${text}
              </td>
            </tr>
          </table>
        `;
      }
    );
  }

  // Rimuove eventuali div wrapper esterni con max-width o overflow per evitare conflitti in Outlook
  cleanedContent = cleanedContent.trim();
  if (cleanedContent.startsWith('<div style="font-family:') && cleanedContent.endsWith('</div>')) {
    // Sostituisci il div contenitore esterno non-Outlook con un wrapper neutro
    cleanedContent = cleanedContent
      .replace(/^<div style="font-family:[^>]*>/i, '')
      .replace(/<\/div>$/i, '');
  }

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <title>${title}</title>
    <!--[if gte mso 9]>
    <xml>
      <o:OfficeDocumentSettings>
        <o:AllowPNG/>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
    <style type="text/css">
      body, table, td, p, a, li, blockquote {
        font-family: Arial, Helvetica, sans-serif !important;
      }
      table { border-collapse: collapse; }
    </style>
    <![endif]-->
    <style type="text/css">
      body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
      table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
      img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
      table { border-collapse: collapse !important; }
      body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #f1f5f9; }
      @media only screen and (max-width: 680px) {
        .email-container {
          width: 100% !important;
          max-width: 100% !important;
        }
        .fluid-padding {
          padding-left: 14px !important;
          padding-right: 14px !important;
        }
      }
    </style>
  </head>
  <body style="margin: 0 !important; padding: 24px 0 !important; background-color: #f1f5f9; font-family: Arial, Helvetica, sans-serif; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%;">
    <!-- Wrapper Generale Centrato -->
    <table border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#f1f5f9" style="background-color: #f1f5f9; width: 100%;">
      <tr>
        <td align="center" style="padding: 10px 12px;">
          
          <!--[if (gte mso 9)|(IE)]>
          <table align="center" border="0" cellspacing="0" cellpadding="0" width="650" style="width: 650px;">
            <tr>
              <td align="center" valign="top" width="650" style="width: 650px;">
          <![endif]-->
          
          <table class="email-container" align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 650px; width: 100%; margin: 0 auto; background-color: #ffffff; border: 1px solid #cbd5e1; border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt;">
            <tr>
              <td align="left" valign="top" style="padding: 0; background-color: #ffffff; font-family: Arial, Helvetica, sans-serif;">
                ${cleanedContent}
              </td>
            </tr>
          </table>
          
          <!--[if (gte mso 9)|(IE)]>
              </td>
            </tr>
          </table>
          <![endif]-->
          
          <!-- Footer Unificato -->
          <!--[if (gte mso 9)|(IE)]>
          <table align="center" border="0" cellspacing="0" cellpadding="0" width="650" style="width: 650px;">
            <tr>
              <td align="center" valign="top" width="650" style="width: 650px;">
          <![endif]-->
          <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 650px; width: 100%; margin: 16px auto 0 auto; text-align: center;">
            <tr>
              <td align="center" style="padding: 8px 16px; font-family: Arial, Helvetica, sans-serif; font-size: 11px; line-height: 1.5; color: #94a3b8; text-align: center;">
                E-mail automatica generata dal sistema di <strong>Pianificazione Aziendale Ingegno</strong>.<br />
                Si prega di non rispondere a questo messaggio.
              </td>
            </tr>
          </table>
          <!--[if (gte mso 9)|(IE)]>
              </td>
            </tr>
          </table>
          <![endif]-->

        </td>
      </tr>
    </table>
  </body>
</html>`;
}
