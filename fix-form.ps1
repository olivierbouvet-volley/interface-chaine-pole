# Script PowerShell pour corriger formulaire-match.html

$filePath = "c:\Projets\projet antigravity\Interface Chaine Pole\formulaire-match.html"
$content = Get-Content $filePath -Raw -Encoding UTF8

# 1. Ajouter le script form-categories.js après storage-service.js
$content = $content -replace '(<script src="storage-service.js"></script>)', '$1`r`n    <script src="form-categories.js"></script>'

# 2. Supprimer les anciennes références aux IDs qui n'existent plus
$content = $content -replace "document\.getElementById\('photoInput'\)", "document.getElementById('photoInput1')"
$content = $content -replace "document\.getElementById\('photoUpload'\)", "document.getElementById('photoUpload1')"
$content = $content -replace "document\.getElementById\('photoPreview'\)", "document.getElementById('photoPreview1')"

# 3. Corriger les références dans le JavaScript de soumission
$content = $content -replace "firstName: document\.getElementById\('firstName'\)\.value\.trim\(\),", "firstName: document.getElementById('team1FirstName').value.trim(),"
$content = $content -replace "lastName: document\.getElementById\('lastName'\)\.value\.trim\(\),", "lastName: document.getElementById('team1LastName').value.trim(),"
$content = $content -replace "clubName: document\.getElementById\('clubName'\)\.value\.trim\(\),", "clubName: document.getElementById('team1Name').value.trim(),"
$content = $content -replace "opponent: document\.getElementById\('opponent'\)\.value\.trim\(\),", "opponent: document.getElementById('team2Name').value.trim(),"

# Sauvegarder
$content | Set-Content $filePath -Encoding UTF8 -NoNewline

Write-Host "✅ Fichier corrigé avec succès!"
