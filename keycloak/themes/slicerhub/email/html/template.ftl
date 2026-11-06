<#-- Layout for SlicerHub's Keycloak emails: plain and readable like the app's own
     emails (backend/src/services/mail.js). Text #040316 on white is 20:1; the quiet
     footer text #555 is 7.5:1. -->
<#macro emailLayout>
<html lang="en">
<body style="margin:0;padding:24px;background:#ffffff;color:#040316;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;">
    <#nested>
</body>
</html>
</#macro>
