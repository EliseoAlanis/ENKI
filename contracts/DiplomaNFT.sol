// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract DiplomaNFT is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;
    
    // Almacenamos la address del KahootManager
    address public kahootManager;

    // Modificador para restringir el minteo solo al contrato Manager
    modifier onlyManager() {
        require(msg.sender == kahootManager, "Solo el Manager puede mintear");
        _;
    }

    constructor(address initialOwner) ERC721("Kahoot Web3 Diploma", "KWD") Ownable(initialOwner) {}

    // Función que llamaremos desde el owner (tu wallet) después de desplegar ambos contratos
    function setKahootManager(address _manager) external onlyOwner {
        require(_manager != address(0), "Address invalida");
        kahootManager = _manager;
    }

    // Función de minteo restringida
    function mintDiploma(address to, string memory tokenURI) external onlyManager {
        uint256 tokenId = _nextTokenId++;
        _mint(to, tokenId);
        _setTokenURI(tokenId, tokenURI);
    }
}