// Gestion du formulaire de déclaration de match - Version 2 avec nouveau système de scoring

let selectedPlayerPhoto = null;
let selectedPosterPhoto = null;
let currentMatchId = null;

// Gestion de l'upload de la photo de la joueuse (Équipe 1)
const photoInput1 = document.getElementById('photoInput1');
const photoUpload1 = document.getElementById('photoUpload1');
const photoPreview1 = document.getElementById('photoPreview1');

if (photoInput1) {
    photoInput1.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Validation
        if (!storageService.validateFileType(file, ['image/jpeg', 'image/png', 'image/webp'])) {
            alert('❌ Format non supporté. Utilisez JPG, PNG ou WEBP.');
            return;
        }

        if (!storageService.validateFileSize(file, 10)) {
            alert('❌ Fichier trop volumineux. Maximum 10 MB.');
            return;
        }

        selectedPlayerPhoto = file;

        // Afficher l'aperçu
        const reader = new FileReader();
        reader.onload = (e) => {
            photoPreview1.src = e.target.result;
            photoPreview1.classList.add('show');
            photoUpload1.classList.add('has-file');
        };
        reader.readAsDataURL(file);
    });
}

// Gestion de l'upload de l'affiche du match
const photoInputPoster = document.getElementById('photoInputPoster');
const photoUploadPoster = document.getElementById('photoUploadPoster');
const photoPreviewPoster = document.getElementById('photoPreviewPoster');

if (photoInputPoster) {
    photoInputPoster.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Validation
        if (!storageService.validateFileType(file, ['image/jpeg', 'image/png', 'image/webp'])) {
            alert('❌ Format non supporté. Utilisez JPG, PNG ou WEBP.');
            return;
        }

        if (!storageService.validateFileSize(file, 10)) {
            alert('❌ Fichier trop volumineux. Maximum 10 MB.');
            return;
        }

        selectedPosterPhoto = file;

        // Afficher l'aperçu
        const reader = new FileReader();
        reader.onload = (e) => {
            photoPreviewPoster.src = e.target.result;
            photoPreviewPoster.classList.add('show');
            photoUploadPoster.classList.add('has-file');
        };
        reader.readAsDataURL(file);
    });
}

// Soumission du formulaire
document.getElementById('matchForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.classList.add('btn-loading');
    submitBtn.textContent = 'Création en cours...';

    try {
        // Récupérer les données du formulaire
        const matchType = document.getElementById('matchType').value;
        const category = document.getElementById('category').value;

        const team1Name = document.getElementById('team1Name').value.trim();
        const team1Color = document.getElementById('team1Color').value;
        const team1FirstName = document.getElementById('team1FirstName').value.trim();
        const team1LastName = document.getElementById('team1LastName').value.trim();

        const team2Name = document.getElementById('team2Name').value.trim();
        const team2ColorEnabled = document.getElementById('team2ColorEnabled').checked;
        const team2Color = team2ColorEnabled ? document.getElementById('team2Color').value : null;

        const matchDate = document.getElementById('matchDate').value;
        const matchTime = document.getElementById('matchTime').value;

        // Upload des photos si présentes
        let playerPhotoUrl = '';
        let posterPhotoUrl = '';

        const tempId = 'temp_' + Date.now();

        if (selectedPlayerPhoto) {
            playerPhotoUrl = await storageService.uploadPlayerPhoto(selectedPlayerPhoto, tempId);
            console.log('✅ Photo joueuse uploadée:', playerPhotoUrl);
        }

        if (selectedPosterPhoto) {
            posterPhotoUrl = await storageService.uploadPlayerPhoto(selectedPosterPhoto, tempId + '_poster');
            console.log('✅ Affiche uploadée:', posterPhotoUrl);
        }

        // Créer le match avec la nouvelle structure
        const matchData = {
            // Informations du match
            matchType: matchType,
            category: category,
            date: matchDate,
            time: matchTime,

            // Équipe 1 (Domicile)
            team1: {
                name: team1Name,
                color: team1Color,
                declarant: {
                    firstName: team1FirstName,
                    lastName: team1LastName,
                    fullName: `${team1FirstName} ${team1LastName}`,
                    photo: playerPhotoUrl
                }
            },

            // Équipe 2 (Extérieur)
            team2: {
                name: team2Name,
                color: team2Color
            },

            // Affiche du match
            posterUrl: posterPhotoUrl,

            // Anciennes données pour compatibilité
            playerName: `${team1FirstName} ${team1LastName}`,
            playerPhoto: playerPhotoUrl,
            clubName: team1Name,
            opponent: team2Name,

            // Système de scoring
            score: {
                pointsHome: 0,
                pointsAway: 0,
                setsHome: 0,
                setsAway: 0
            },

            // Historique et état
            setHistory: [],
            actionHistory: [],
            currentSet: 1,
            status: 'upcoming'
        };

        currentMatchId = await dbService.createMatch(matchData);
        console.log('✅ Match créé:', currentMatchId);

        // Afficher la modal de succès
        showSuccessModal(currentMatchId);

    } catch (error) {
        console.error('❌ Erreur:', error);
        alert('❌ Une erreur est survenue. Veuillez réessayer.');

        submitBtn.disabled = false;
        submitBtn.classList.remove('btn-loading');
        submitBtn.textContent = '✨ Déclarer le match';
    }
});

function showSuccessModal(matchId) {
    const modal = document.getElementById('successModal');
    const linkBox = document.getElementById('parentLink');

    // Générer le lien pour le parent
    const baseUrl = window.location.origin + window.location.pathname.replace('formulaire-match.html', '');
    const parentUrl = `${baseUrl}interface-parent.html?match=${matchId}`;

    linkBox.textContent = parentUrl;

    // Générer le QR code
    document.getElementById('qrcode').innerHTML = '';
    new QRCode(document.getElementById('qrcode'), {
        text: parentUrl,
        width: 200,
        height: 200,
        colorDark: '#6366F1',
        colorLight: '#ffffff'
    });

    modal.classList.add('show');
    document.body.classList.add('modal-open');
}

function copyLink() {
    const linkBox = document.getElementById('parentLink');
    const textArea = document.createElement('textarea');
    textArea.value = linkBox.textContent;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);

    alert('✅ Lien copié dans le presse-papier !');
}

// Définir la date minimale à aujourd'hui
const today = new Date().toISOString().split('T')[0];
document.getElementById('matchDate').min = today;
