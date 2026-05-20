// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract DiplomaNFT is ERC721, Ownable {
    uint256 private _nextTokenId;
    address public kahootManager;

    // Inicializamos el NFT y le asignamos el Owner (ustedes)
    constructor(address initialOwner) ERC721("KahootDiploma", "KHDIP") Ownable(initialOwner) {}

    // Función para conectar este NFT con el contrato del juego
    function setKahootManager(address _kahootManager) external onlyOwner {
        kahootManager = _kahootManager;
    }

    // Solo el contrato de KahootManager puede llamar a esta función
    function mint(address to) external {
        require(msg.sender == kahootManager, "Solo el KahootManager puede mintear");
        
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
    }
}