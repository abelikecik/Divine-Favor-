require('dotenv').config();

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const path = require('path');

const app = express();
const port = Number(process.env.PORT || 3000);

if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
  throw new Error('DATABASE_URL and SESSION_SECRET must be configured.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 10
});

app.set('trust proxy', Number(process.env.TRUST_PROXY || 1));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

function clean(value, max=200) {
  return String(value ?? '').trim().slice(0, max);
}

function validTerm(term) {
  return ['First Term','Second Term','Third Term'].includes(term);
}

function requireStaff(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Staff login required.' });
  next();
}

function requireOwner(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'owner') {
    return res.status(403).json({ error: 'Owner access required.' });
  }
  next();
}

async function getUser(userId) {
  const r = await pool.query(
    `SELECT u.id,u.username,u.role,u.class_id,c.name AS class_name
     FROM users u LEFT JOIN classes c ON c.id=u.class_id WHERE u.id=$1`,
    [userId]
  );
  return r.rows[0] || null;
}

app.get('/api/health', async (req,res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok:false });
  }
});

app.get('/api/classes', async (req,res) => {
  const r = await pool.query('SELECT id,name FROM classes ORDER BY sort_order');
  res.json(r.rows);
});

app.post('/api/login/parent', async (req,res) => {
  const className = clean(req.body.className, 80);
  const term = clean(req.body.term, 30);
  const studentNo = Number(req.body.studentNo);
  const year = Number(req.body.year);

  if (!className || !validTerm(term) || !Number.isInteger(studentNo) || studentNo < 1 ||
      !Number.isInteger(year) || year < 2000 || year > 2100) {
    return res.status(400).json({ error:'Enter a valid class, term, register number and year.' });
  }

  const r = await pool.query(
    `SELECT r.id,r.term,r.school_year,r.position,r.comments,r.status,
            s.register_no,s.full_name,c.name AS class_name,
            COALESCE(json_agg(json_build_object(
              'subject',rs.subject,'ca',rs.ca,'exam',rs.exam,'total',(rs.ca+rs.exam)
            ) ORDER BY rs.subject) FILTER (WHERE rs.id IS NOT NULL),'[]') AS scores
     FROM results r
     JOIN students s ON s.id=r.student_id
     JOIN classes c ON c.id=s.class_id
     LEFT JOIN result_scores rs ON rs.result_id=r.id
     WHERE c.name=$1 AND s.register_no=$2 AND r.term=$3 AND r.school_year=$4
       AND r.status='published'
     GROUP BY r.id,s.id,c.id`,
    [className, studentNo, term, year]
  );

  if (!r.rows.length) return res.status(404).json({ error:'No published result was found for those details.' });

  const result = r.rows[0];
  const numericScores = result.scores.map(x => Number(x.total));
  const total = numericScores.reduce((a,b)=>a+b,0);
  const average = numericScores.length ? total/numericScores.length : 0;

  res.json({...result, total, average:Number(average.toFixed(2))});
});

app.post('/api/login/staff', async (req,res) => {
  const username = clean(req.body.username, 80);
  const password = String(req.body.password || '');
  const r = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
  if (!r.rows.length || !(await bcrypt.compare(password, r.rows[0].password_hash))) {
    return res.status(401).json({ error:'Invalid username or password.' });
  }
  const user = await getUser(r.rows[0].id);
  req.session.user = user;
  res.json({ user });
});

app.post('/api/login/owner', async (req,res) => {
  const password = String(req.body.password || '');
  const r = await pool.query(`SELECT * FROM users WHERE username='owner' AND role='owner'`);
  if (!r.rows.length || !(await bcrypt.compare(password, r.rows[0].password_hash))) {
    return res.status(401).json({ error:'Invalid owner password.' });
  }
  const user = await getUser(r.rows[0].id);
  req.session.user = user;
  res.json({ user });
});

app.post('/api/logout', (req,res) => {
  req.session.destroy(() => res.json({ ok:true }));
});

app.get('/api/me', async (req,res) => {
  if (!req.session.user) return res.json({ user:null });
  const user = await getUser(req.session.user.id);
  req.session.user = user;
  res.json({ user });
});

app.get('/api/students', requireStaff, async (req,res) => {
  const user = req.session.user;
  const params = [];
  let where = '';
  if (user.role === 'teacher') {
    params.push(user.class_id);
    where = 'WHERE s.class_id=$1';
  }
  const r = await pool.query(
    `SELECT s.id,s.register_no,s.full_name,c.name AS class_name
     FROM students s JOIN classes c ON c.id=s.class_id
     ${where} ORDER BY c.sort_order,s.register_no`,
    params
  );
  res.json(r.rows);
});

app.post('/api/students', requireStaff, async (req,res) => {
  const user = req.session.user;
  const name = clean(req.body.fullName, 120);
  const reg = Number(req.body.registerNo);
  let classId = Number(req.body.classId);

  if (!name || !Number.isInteger(reg) || reg < 1) return res.status(400).json({error:'Valid student name and register number are required.'});
  if (user.role === 'teacher') classId = user.class_id;
  if (!Number.isInteger(classId)) return res.status(400).json({error:'Class is required.'});

  try {
    const r = await pool.query(
      `INSERT INTO students(class_id,register_no,full_name) VALUES($1,$2,$3)
       RETURNING id,register_no,full_name,class_id`,
      [classId,reg,name]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({error:'That register number is already used in this class.'});
    throw e;
  }
});

app.get('/api/results', requireStaff, async (req,res) => {
  const user=req.session.user;
  const params=[];
  let where='';
  if(user.role==='teacher'){params.push(user.class_id);where='WHERE s.class_id=$1';}
  const r=await pool.query(
    `SELECT r.id,r.term,r.school_year,r.position,r.comments,r.status,
            s.id AS student_id,s.register_no,s.full_name,c.name AS class_name
     FROM results r JOIN students s ON s.id=r.student_id JOIN classes c ON c.id=s.class_id
     ${where} ORDER BY c.sort_order,s.register_no,r.school_year DESC,r.term`,
    params
  );
  res.json(r.rows);
});

app.post('/api/results', requireStaff, async (req,res) => {
  const user=req.session.user;
  const studentId=Number(req.body.studentId);
  const term=clean(req.body.term,30);
  const year=Number(req.body.year);
  const position=req.body.position === '' || req.body.position == null ? null : Number(req.body.position);
  const comments=clean(req.body.comments,1000);
  const scores=Array.isArray(req.body.scores) ? req.body.scores : [];

  if(!Number.isInteger(studentId) || !validTerm(term) || !Number.isInteger(year) || year<2000 || year>2100)
    return res.status(400).json({error:'Invalid result details.'});

  const student=await pool.query('SELECT * FROM students WHERE id=$1',[studentId]);
  if(!student.rows.length) return res.status(404).json({error:'Student not found.'});
  if(user.role==='teacher' && student.rows[0].class_id !== user.class_id)
    return res.status(403).json({error:'You can only manage students in your assigned class.'});

  const normalized=[];
  for(const s of scores){
    const subject=clean(s.subject,100);
    const ca=Number(s.ca), exam=Number(s.exam);
    if(!subject) continue;
    if(!Number.isFinite(ca)||ca<0||ca>40||!Number.isFinite(exam)||exam<0||exam>60)
      return res.status(400).json({error:`Invalid score for ${subject}. CA must be 0-40 and exam 0-60.`});
    normalized.push({subject,ca,exam});
  }

  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const existing=await client.query(
      `SELECT id,status FROM results WHERE student_id=$1 AND term=$2 AND school_year=$3 FOR UPDATE`,
      [studentId,term,year]
    );
    let resultId;
    if(existing.rows.length){
      if(existing.rows[0].status==='published' && user.role!=='owner')
        return res.status(409).json({error:'This result has already been published. Only the owner can edit it.'});
      resultId=existing.rows[0].id;
      await client.query(
        `UPDATE results SET position=$1,comments=$2,status='draft',updated_at=NOW(),created_by=$3 WHERE id=$4`,
        [position,comments,user.id,resultId]
      );
      await client.query('DELETE FROM result_scores WHERE result_id=$1',[resultId]);
    }else{
      const ins=await client.query(
        `INSERT INTO results(student_id,term,school_year,position,comments,status,created_by)
         VALUES($1,$2,$3,$4,$5,'draft',$6) RETURNING id`,
        [studentId,term,year,position,comments,user.id]
      );
      resultId=ins.rows[0].id;
    }
    for(const s of normalized){
      await client.query(
        `INSERT INTO result_scores(result_id,subject,ca,exam) VALUES($1,$2,$3,$4)`,
        [resultId,s.subject,s.ca,s.exam]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({id:resultId,status:'draft'});
  }catch(e){
    await client.query('ROLLBACK');
    throw e;
  }finally{client.release();}
});

app.post('/api/results/:id/publish', requireOwner, async (req,res) => {
  const id=Number(req.params.id);
  if(!Number.isInteger(id)) return res.status(400).json({error:'Invalid result.'});
  const r=await pool.query(`UPDATE results SET status='published',updated_at=NOW() WHERE id=$1 RETURNING id,status`,[id]);
  if(!r.rows.length) return res.status(404).json({error:'Result not found.'});
  res.json(r.rows[0]);
});

app.post('/api/users/change-password', requireStaff, async (req,res) => {
  const current=String(req.body.currentPassword||'');
  const next=String(req.body.newPassword||'');
  if(next.length<10) return res.status(400).json({error:'New password must be at least 10 characters.'});
  const r=await pool.query('SELECT password_hash FROM users WHERE id=$1',[req.session.user.id]);
  if(!r.rows.length || !(await bcrypt.compare(current,r.rows[0].password_hash)))
    return res.status(401).json({error:'Current password is incorrect.'});
  const hash=await bcrypt.hash(next,12);
  await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hash,req.session.user.id]);
  res.json({ok:true});
});

app.use(express.static(path.join(__dirname,'public')));
app.get('*', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));

app.use((err,req,res,next)=>{
  console.error(err);
  res.status(500).json({error:'Server error.'});
});

app.listen(port,()=>console.log(`Divine Favor portal listening on ${port}`));