console.log('Main script loading...');

document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded');
    
    const searchBtn = document.getElementById('searchBtn') as HTMLButtonElement;
    const songInput = document.getElementById('songInput') as HTMLInputElement;
    const status = document.getElementById('status')!;
    
    if (!searchBtn || !songInput || !status) {
        console.error('UI elements not found!');
        return;
    }
    
    console.log('UI elements found');
    
    searchBtn.addEventListener('click', async function() {
        console.log('Search button clicked!');
        
        const songName = songInput.value.trim();
        if (!songName) return;
        
        status.textContent = 'Searching...';
        searchBtn.disabled = true;
        
        try {
            const response = await fetch(`http://localhost:3001/api/midi/search?q=${encodeURIComponent(songName)}`);
            const data = await response.json();
            
            console.log('Search results:', data);
            status.textContent = `Found ${data.count} results: ${data.results.map((r: any) => r.title).join(', ')}`;
            
        } catch (error) {
            console.error('Search error:', error);
            status.textContent = `Search error: ${error}`;
        } finally {
            searchBtn.disabled = false;
        }
    });
    
    console.log('Event listeners attached');
});