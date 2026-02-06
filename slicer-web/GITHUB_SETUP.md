# GitHub Setup Guide

This guide will help you publish your Medical Imaging Viewer project to GitHub.

## Before You Start

Make sure you have:
- A GitHub account (create one at https://github.com)
- Git installed on your computer
- The project is working locally

## Step 1: Verify .gitignore

The project already has a `.gitignore` file that excludes:
- ✅ `node_modules/` - Dependencies (will be reinstalled)
- ✅ `backend/data/*.db` - Database files (contains user data)
- ✅ `backend/userFiles/` - User uploaded files
- ✅ `.env` - Environment variables (may contain secrets)
- ✅ `*.log` - Log files

**Important**: Never commit sensitive data like:
- Database files with user information
- User uploaded files
- `.env` files with secrets
- `node_modules` folders

## Step 2: Initialize Git Repository

Open PowerShell in your project root directory:

```powershell
cd C:\Users\rlhisey\Documents\litApp\lit-element-starter-js-lit-element-2.x
```

Initialize git if not already initialized:

```powershell
git init
```

## Step 3: Stage Your Files

Add all files (respecting .gitignore):

```powershell
git add .
```

Check what will be committed:

```powershell
git status
```

You should see your source code files but NOT:
- `node_modules/`
- `backend/data/users.db`
- `backend/userFiles/`
- Any `.env` files

## Step 4: Create Initial Commit

```powershell
git commit -m "Initial commit: Medical Imaging Viewer application"
```

## Step 5: Create GitHub Repository

1. Go to https://github.com/new
2. Enter a repository name (e.g., `medical-imaging-viewer`)
3. Add a description (optional): "Web-based medical imaging viewer with 3D visualization"
4. Choose **Public** or **Private**
5. **DO NOT** check "Add a README file" (you already have one)
6. **DO NOT** add .gitignore or license (you have these)
7. Click "Create repository"

## Step 6: Link Local Repository to GitHub

GitHub will show you commands. Use these:

```powershell
# Add remote (replace with your actual repository URL)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# Rename branch to main (if needed)
git branch -M main

# Push to GitHub
git push -u origin main
```

**Example:**
```powershell
git remote add origin https://github.com/rlhisey/medical-imaging-viewer.git
git branch -M main
git push -u origin main
```

## Step 7: Verify Upload

1. Refresh your GitHub repository page
2. You should see all your files
3. Verify that sensitive files are NOT visible:
   - No `users.db` file
   - No `userFiles/` directory contents
   - No `node_modules/`

## Step 8: Update README (Recommended)

Consider updating the main [README.md](README.md) to replace the boilerplate starter content with information about your medical imaging viewer application.

## Step 9: Set Up Repository Settings

### Add Repository Description
1. Go to your repository page
2. Click the ⚙️ gear icon next to "About"
3. Add description: "Web-based medical imaging viewer with 3D visualization using Lit Elements and Trame/VTK"
4. Add topics: `medical-imaging`, `lit-elements`, `vtk`, `trame`, `docker`, `nodejs`

### Set Up Branch Protection (Optional)
1. Go to Settings → Branches
2. Add branch protection rule for `main`
3. Enable "Require pull request reviews before merging"

## Future Commits

When you make changes:

```powershell
# Check what changed
git status

# Stage changes
git add .

# Commit with descriptive message
git commit -m "Add feature: description of what you added"

# Push to GitHub
git push
```

## Common Git Commands

```powershell
# See commit history
git log --oneline

# Undo uncommitted changes to a file
git checkout -- filename

# Create a new branch
git checkout -b feature/new-feature

# Switch branches
git checkout main

# Merge branch into main
git checkout main
git merge feature/new-feature

# Pull latest changes from GitHub
git pull

# See remote repository URL
git remote -v
```

## Gitignore Best Practices

If you need to add more files to ignore:

```powershell
# Edit .gitignore file
notepad .gitignore

# Stage and commit the changes
git add .gitignore
git commit -m "Update .gitignore"
git push
```

## Removing Accidentally Committed Files

If you accidentally committed sensitive files:

```powershell
# Remove from git but keep locally
git rm --cached backend/data/users.db

# Commit the removal
git commit -m "Remove database file from version control"

# Push changes
git push
```

## Security Checklist

Before pushing to GitHub, verify:

- [ ] No database files with user data
- [ ] No `.env` files with secrets
- [ ] No `JWT_SECRET` or passwords in code
- [ ] No user uploaded files
- [ ] No `node_modules/` directories
- [ ] No API keys or credentials

## Environment Variables for Deployment

Create a `.env.example` file to show what environment variables are needed (without actual values):

```env
# .env.example
JWT_SECRET=your-secret-key-here
NODE_ENV=development
API_URL=http://localhost:8080
PORT=8080
```

Add this to git:
```powershell
git add .env.example
git commit -m "Add environment variables template"
git push
```

## Collaboration

### Inviting Collaborators
1. Go to Settings → Collaborators
2. Click "Add people"
3. Enter their GitHub username
4. Choose permission level

### Working with Pull Requests
1. Collaborators fork your repository
2. They make changes in their fork
3. They create a Pull Request
4. You review and merge

## GitHub Features to Use

### Issues
- Track bugs and feature requests
- Go to "Issues" tab → "New issue"

### Projects
- Organize work with kanban boards
- Go to "Projects" tab → "New project"

### Releases
- Tag stable versions
- Go to "Releases" → "Create a new release"

### GitHub Actions (Advanced)
- Automate testing and deployment
- Create `.github/workflows/` directory with YAML files

## Troubleshooting

### Authentication Issues
If you get authentication errors:

**Option 1: Use Personal Access Token**
1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate new token (classic)
3. Select scopes: `repo`
4. Use token as password when pushing

**Option 2: Use SSH**
```powershell
# Generate SSH key
ssh-keygen -t ed25519 -C "your_email@example.com"

# Add to GitHub: Settings → SSH keys → New SSH key
# Then use SSH URL instead
git remote set-url origin git@github.com:USERNAME/REPO.git
```

### Large Files
If you have files over 100MB:
- Don't commit them (add to .gitignore)
- Consider Git LFS for necessary large files
- Store user files outside git

### Rejected Push
If push is rejected:
```powershell
# Pull latest changes first
git pull --rebase origin main

# Then push
git push
```

## Next Steps

1. ✅ Push code to GitHub
2. Add comprehensive README
3. Add LICENSE file
4. Set up GitHub Actions for CI/CD
5. Create documentation in `/docs`
6. Tag releases (v1.0.0, v1.1.0, etc.)
7. Write CONTRIBUTING.md for collaborators

## Resources

- [GitHub Docs](https://docs.github.com)
- [Git Cheat Sheet](https://education.github.com/git-cheat-sheet-education.pdf)
- [Pro Git Book](https://git-scm.com/book/en/v2)
- [GitHub Flow](https://guides.github.com/introduction/flow/)
