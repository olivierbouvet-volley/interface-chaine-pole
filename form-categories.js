// Script pour gérer les catégories dynamiques du formulaire de match
document.addEventListener('DOMContentLoaded', () => {
    const matchTypeSelect = document.getElementById('matchType');
    const categorySelect = document.getElementById('category');
    const team1ColorInput = document.getElementById('team1Color');
    const team1ColorHex = document.getElementById('team1ColorHex');
    const team2ColorInput = document.getElementById('team2Color');
    const team2ColorHex = document.getElementById('team2ColorHex');

    // Catégories selon le type de compétition
    const categories = {
        championnat: [
            { value: 'Elite', label: 'Elite' },
            { value: 'Nat2', label: 'Nationale 2' },
            { value: 'Nat3', label: 'Nationale 3' },
            { value: 'PreNat', label: 'Pré-Nationale' },
            { value: 'Reg', label: 'Régionale' },
            { value: 'Depart', label: 'Départementale' },
            { value: 'M18', label: 'Championnat M18' },
            { value: 'M15', label: 'Championnat M15' }
        ],
        coupe: [
            { value: 'M13', label: 'M13 (Moins de 13 ans)' },
            { value: 'M15', label: 'M15 (Moins de 15 ans)' },
            { value: 'M18', label: 'M18 (Moins de 18 ans)' },
            { value: 'M21', label: 'M21 (Moins de 21 ans)' }
        ]
    };

    // Mettre à jour les catégories quand le type de match change
    if (matchTypeSelect && categorySelect) {
        matchTypeSelect.addEventListener('change', (e) => {
            const matchType = e.target.value;
            categorySelect.innerHTML = '<option value="">Sélectionnez une catégorie...</option>';

            if (matchType && categories[matchType]) {
                categories[matchType].forEach(cat => {
                    const option = document.createElement('option');
                    option.value = cat.value;
                    option.textContent = cat.label;
                    categorySelect.appendChild(option);
                });
                categorySelect.disabled = false;
            } else {
                categorySelect.disabled = true;
            }
        });
    }

    // Synchroniser les sélecteurs de couleur avec les champs hex
    if (team1ColorInput && team1ColorHex) {
        team1ColorInput.addEventListener('input', (e) => {
            team1ColorHex.value = e.target.value.toUpperCase();
        });
    }

    if (team2ColorInput && team2ColorHex) {
        team2ColorInput.addEventListener('input', (e) => {
            team2ColorHex.value = e.target.value.toUpperCase();
        });
    }

    // Gérer la checkbox de couleur équipe 2
    const team2ColorEnabled = document.getElementById('team2ColorEnabled');
    if (team2ColorEnabled && team2ColorInput) {
        team2ColorInput.disabled = !team2ColorEnabled.checked;
        team2ColorHex.disabled = !team2ColorEnabled.checked;

        team2ColorEnabled.addEventListener('change', (e) => {
            team2ColorInput.disabled = !e.target.checked;
            team2ColorHex.disabled = !e.target.checked;
            if (!e.target.checked) {
                team2ColorInput.value = '#6B7280';
                team2ColorHex.value = '#6B7280';
            }
        });
    }
});
