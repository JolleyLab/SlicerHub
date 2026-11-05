# Baseline security response headers. Included at server level AND inside every
# location that has its own add_header (nginx drops inherited add_header directives
# in a block that defines any of its own).
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "same-origin" always;
# Only this site may frame its pages (viewer iframes are same-origin).
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Content-Security-Policy "frame-ancestors 'self'" always;
# Empty (header omitted) unless the client connection is HTTPS; see map in default.conf.
add_header Strict-Transport-Security $hsts_header always;
