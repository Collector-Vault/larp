// Inert Semgrep fixtures. Do not import or execute this file.
function positive(source) {
  // ruleid: diff-dynamic-code
  eval(source);
  // ruleid: diff-dynamic-code
  new Function(source);
  // ruleid: diff-disable-tls
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  // ruleid: diff-disable-tls
  process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
  // ruleid: diff-disable-tls
  const insecure = {rejectUnauthorized: false};
}
function negative(source) {
  // ok: diff-dynamic-code
  JSON.parse(source);
  // ok: diff-dynamic-code
  const text = 'eval(source) is not executed';
  // ok: diff-disable-tls
  const secure = {rejectUnauthorized: true};
  return secure;
}
