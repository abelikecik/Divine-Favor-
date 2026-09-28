CREATE TABLE IF NOT EXISTS classes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','teacher')),
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  register_no INTEGER NOT NULL CHECK (register_no > 0),
  full_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(class_id, register_no)
);

CREATE TABLE IF NOT EXISTS results (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  term TEXT NOT NULL CHECK (term IN ('First Term','Second Term','Third Term')),
  school_year INTEGER NOT NULL CHECK (school_year >= 2000 AND school_year <= 2100),
  position INTEGER CHECK (position IS NULL OR position > 0),
  comments TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, term, school_year)
);

CREATE TABLE IF NOT EXISTS result_scores (
  id SERIAL PRIMARY KEY,
  result_id INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  ca NUMERIC(5,2) NOT NULL CHECK (ca >= 0 AND ca <= 40),
  exam NUMERIC(5,2) NOT NULL CHECK (exam >= 0 AND exam <= 60),
  UNIQUE(result_id, subject)
);

CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default" PRIMARY KEY,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_results_lookup ON results(student_id, term, school_year, status);
