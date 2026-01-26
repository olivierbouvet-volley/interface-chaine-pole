// ============================================
// SERVICE STOCKAGE
// Fonctions d'upload vers Firebase Storage
// ============================================

const storageService = {

    /**
     * Compresse une image avant upload
     * @param {File} file - Fichier image
     * @param {number} maxWidth - Largeur maximale (défaut: 800px)
     * @param {number} quality - Qualité JPEG (défaut: 0.8)
     * @returns {Promise<Blob>} Image compressée
     */
    async compressImage(file, maxWidth = 800, quality = 0.8) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                const img = new Image();

                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    // Redimensionner si nécessaire
                    if (width > maxWidth) {
                        height = (height / width) * maxWidth;
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;

                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob(
                        (blob) => {
                            if (blob) {
                                resolve(blob);
                            } else {
                                reject(new Error('Erreur compression image'));
                            }
                        },
                        'image/jpeg',
                        quality
                    );
                };

                img.onerror = () => reject(new Error('Erreur chargement image'));
                img.src = e.target.result;
            };

            reader.onerror = () => reject(new Error('Erreur lecture fichier'));
            reader.readAsDataURL(file);
        });
    },

    /**
     * Upload un fichier vers Firebase Storage
     * @param {File} file - Fichier à uploader
     * @param {string} path - Chemin dans Storage (ex: 'sponsors/sponsor_123')
     * @param {Function} onProgress - Callback de progression (optionnel)
     * @returns {Promise<string>} URL de téléchargement du fichier
     */
    async uploadFile(file, path, onProgress = null) {
        try {
            const storageRef = firebase.storage().ref(path);
            const uploadTask = storageRef.put(file);

            return new Promise((resolve, reject) => {
                uploadTask.on(
                    'state_changed',
                    (snapshot) => {
                        // Calcul de la progression
                        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                        console.log(`Upload: ${progress.toFixed(2)}%`);

                        if (onProgress) {
                            onProgress(progress);
                        }
                    },
                    (error) => {
                        console.error('❌ Erreur upload:', error);
                        reject(error);
                    },
                    async () => {
                        // Upload terminé avec succès
                        const downloadURL = await uploadTask.snapshot.ref.getDownloadURL();
                        console.log('✅ Fichier uploadé:', downloadURL);
                        resolve(downloadURL);
                    }
                );
            });
        } catch (error) {
            console.error('❌ Erreur upload file:', error);
            throw error;
        }
    },

    /**
     * Upload une photo de joueuse (avec compression)
     * @param {File} file - Fichier image
     * @param {string} playerId - ID de la joueuse
     * @param {Function} onProgress - Callback de progression
     * @returns {Promise<string>} URL de la photo
     */
    async uploadPlayerPhoto(file, playerId, onProgress = null) {
        try {
            console.log('🔄 Compression de la photo...');
            const compressedBlob = await this.compressImage(file, 600, 0.85);

            const path = `players/${playerId}/photo.jpg`;
            const url = await this.uploadFile(compressedBlob, path, onProgress);

            return url;
        } catch (error) {
            console.error('❌ Erreur upload photo joueuse:', error);
            throw error;
        }
    },

    /**
     * Upload un logo de club (avec compression)
     * @param {File} file - Fichier image
     * @param {string} clubName - Nom du club
     * @param {Function} onProgress - Callback de progression
     * @returns {Promise<string>} URL du logo
     */
    async uploadClubLogo(file, clubName, onProgress = null) {
        try {
            console.log('🔄 Compression du logo...');
            const compressedBlob = await this.compressImage(file, 400, 0.9);

            const sanitizedName = clubName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const path = `clubs/${sanitizedName}_${Date.now()}.jpg`;
            const url = await this.uploadFile(compressedBlob, path, onProgress);

            return url;
        } catch (error) {
            console.error('❌ Erreur upload logo club:', error);
            throw error;
        }
    },

    /**
     * Upload un média sponsor (image ou vidéo)
     * @param {File} file - Fichier média
     * @param {string} sponsorId - ID du sponsor
     * @param {Function} onProgress - Callback de progression
     * @returns {Promise<string>} URL du média
     */
    async uploadSponsorMedia(file, sponsorId, onProgress = null) {
        try {
            const fileType = file.type.split('/')[0]; // 'image' ou 'video'

            if (fileType === 'image') {
                console.log('🔄 Compression de l\'image sponsor...');
                const compressedBlob = await this.compressImage(file, 1920, 0.85);

                const path = `sponsors/${sponsorId}/media.jpg`;
                return await this.uploadFile(compressedBlob, path, onProgress);
            } else if (fileType === 'video') {
                console.log('🔄 Upload de la vidéo sponsor...');
                const extension = file.name.split('.').pop();
                const path = `sponsors/${sponsorId}/media.${extension}`;
                return await this.uploadFile(file, path, onProgress);
            } else {
                throw new Error('Type de fichier non supporté. Utilisez une image ou une vidéo.');
            }
        } catch (error) {
            console.error('❌ Erreur upload média sponsor:', error);
            throw error;
        }
    },

    /**
     * Supprime un fichier de Firebase Storage
     * @param {string} url - URL du fichier à supprimer
     * @returns {Promise<void>}
     */
    async deleteFile(url) {
        try {
            const fileRef = firebase.storage().refFromURL(url);
            await fileRef.delete();
            console.log('✅ Fichier supprimé:', url);
        } catch (error) {
            console.error('❌ Erreur suppression fichier:', error);
            throw error;
        }
    },

    /**
     * Valide le type de fichier
     * @param {File} file - Fichier à valider
     * @param {Array} allowedTypes - Types MIME autorisés
     * @returns {boolean} True si valide
     */
    validateFileType(file, allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4']) {
        return allowedTypes.includes(file.type);
    },

    /**
     * Valide la taille du fichier
     * @param {File} file - Fichier à valider
     * @param {number} maxSizeMB - Taille maximale en MB
     * @returns {boolean} True si valide
     */
    validateFileSize(file, maxSizeMB = 10) {
        const maxSizeBytes = maxSizeMB * 1024 * 1024;
        return file.size <= maxSizeBytes;
    },

    /**
     * Formate la taille d'un fichier en texte lisible
     * @param {number} bytes - Taille en octets
     * @returns {string} Taille formatée (ex: "2.5 MB")
     */
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';

        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));

        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    }
};

// Export global
window.storageService = storageService;
