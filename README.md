# Divine Favor Learning Center — Railway-ready results portal

## What is included
- Node.js + Express server
- PostgreSQL database
- Secure server-side sessions stored in PostgreSQL
- Password hashing with bcrypt
- Helmet security headers
- Teacher class restrictions
- Owner-only publishing
- Parent lookup for published results
- Full subject/CA/exam/total display for parents
- Student register numbers per class
- Teacher/owner password change
- Railway deployment configuration and checklist

## Initial accounts after seeding
Owner:
- Username: owner
- Password: owner2026

Teachers:
- Username: exact class name
- Initial password: same as class name

Example:
- JS1 / JS1
- Primary 1 / Primary 1

Change these passwords before entering real student information.

## Important
This package is ready to deploy, but the deployment account and database must belong to you/school. Never send passwords, database credentials, or SESSION_SECRET in chat.

For production, use HTTPS, keep Railway variables private, and create regular database backups.
